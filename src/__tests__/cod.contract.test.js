/**
 * Live-DB contract test for the Cash/Card-on-Delivery flow (Layer 1 + 2).
 *
 * Checkout requires a signed-in customer (20260808120000): `place_cod_order`
 * is granted to `authenticated` only, raises without auth.uid(), stamps the
 * order with the account's user_id, and OVERRIDES customer_email with the
 * account email. Customers read their own rows via the `orders_owner_select`
 * RLS policy. Tracking stays anonymous for pre-account orders:
 *   - get_order_tracking   — anon tracks by order_number + email (email is
 *                            the shared secret; wrong email -> null).
 *   - admin_update_order_status — admin-only; non-admins must be rejected.
 *
 * This spec exercises the real RPCs against the live DB as the roles real
 * users hold: a run-tagged CONFIRMED customer account (created/destroyed with
 * the service-role admin API) plus the plain ANON key. Key controls:
 *   NEGATIVE — anon can NO LONGER place an order (account requirement).
 *   POSITIVE — a signed-in customer places an order; the row carries their
 *              user_id and their ACCOUNT email (client email is ignored).
 *   POSITIVE — the customer reads their own order through RLS.
 *   POSITIVE — anon tracking by number + email still works (old orders).
 *   NEGATIVE — tracking with the WRONG email returns null (no enumeration).
 *   NEGATIVE — an authenticated NON-admin cannot update order status.
 *
 * ISOLATION: every fixture this suite creates — the account, the product it
 * orders, the resulting order — carries RUN_TAG, so a concurrent or orphaned
 * vitest run cannot see or delete them. It also buys its OWN throwaway product
 * rather than a seeded one, so no real inventory moves and there is no
 * read-modify-write stock restore to get wrong. See the header of
 * `helpers/liveFixtures.js` for why this matters.
 *
 * afterAll deletes everything it made. Test orders in particular must not
 * survive: admin/Dashboard.jsx counts orders and sums their totals for the
 * revenue tiles, so a leftover would read as a real sale.
 *
 * Auto-skips unless BOTH VITE_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY
 * are set (service role is required for safe cleanup, so we don't mutate the
 * DB without a way to undo it).
 *
 * How to run (PowerShell):
 *   npx vitest run src/__tests__/cod.contract.test.js
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  KEYS_MISSING, anonClient, serviceClient,
  testEmail, testSlug, createTestUser, signInAs, deleteTestUsers, mustSucceed,
} from './helpers/liveFixtures.js'

const SKIP = KEYS_MISSING
const TEST_QTY = 1
const PRODUCT_SLUG = testSlug('cod-product')
const PRODUCT_PRICE = 12000
const START_STOCK = 5

const anon = SKIP ? null : anonClient()
const admin = SKIP ? null : serviceClient()
// Signed in as the test customer in beforeAll — the role real buyers hold.
const userClient = SKIP ? null : anonClient()

// Shared state across the ordered tests.
let productId = null
let testUserId = null
let testUserEmail = null
let orderNumber = null
let placedTotal = 0

describe.skipIf(SKIP)('COD contract — account-required ordering + tracking RPCs', () => {
  beforeAll(async () => {
    // Our own product, so the order under test cannot collide with another run
    // and no seeded stock is disturbed.
    const prod = mustSucceed('create test product', await admin
      .from('products')
      .insert({
        name: `Vitest COD Product ${PRODUCT_SLUG}`,
        slug: PRODUCT_SLUG,
        price: PRODUCT_PRICE,
        category: 'accessories',
        stock_quantity: START_STOCK,
        is_available: true,
        is_member_only: false,
      })
      .select('id')
      .single())
    productId = prod.id

    const user = await createTestUser(admin, 'cod')
    testUserId = user.id
    testUserEmail = user.email
    await signInAs(userClient, testUserEmail)
  })

  afterAll(async () => {
    if (!admin) return
    // Orders first — a stray test order would show up in the admin dashboard's
    // order count and revenue tiles as a real sale.
    await admin.from('orders').delete().eq('customer_email', testUserEmail ?? testEmail('cod'))
    await admin.from('products').delete().eq('slug', PRODUCT_SLUG)
    await deleteTestUsers(admin, testUserId)
  })

  const orderPayload = () => ({
    p_customer: {
      name: 'Vitest COD',
      // Deliberately NOT the account email — the server must ignore this and
      // stamp the (verified) account email instead.
      email: 'spoofed+attacker@example.com',
      phone: '0000000000',
      street: '1 Test St',
      apartment: '',
      city: 'Boksburg',
      province: 'Gauteng',
      postalCode: '1459',
    },
    p_items: [{ id: productId, quantity: TEST_QTY }],
    p_payment_method: 'cash_on_delivery',
  })

  it('POSITIVE: anon sees the product on the storefront (public products SELECT)', async () => {
    const { data, error } = await anon
      .from('products')
      .select('id, name, price, stock_quantity, is_available')
      .eq('id', productId)
      .single()
    expect(error).toBeNull()
    expect(data.is_available).toBe(true)
    expect(data.price).toBe(PRODUCT_PRICE)
  })

  it('NEGATIVE: anon can no longer place_cod_order (account required)', async () => {
    const { data, error } = await anon.rpc('place_cod_order', orderPayload())
    // Either the revoked grant blocks the call or the auth.uid() check raises —
    // the only unacceptable outcome is an order being created.
    expect(error).not.toBeNull()
    expect(data).toBeNull()
  })

  it('POSITIVE: a signed-in customer places an order stamped with their user_id and ACCOUNT email', async () => {
    const { data, error } = await userClient.rpc('place_cod_order', orderPayload())
    expect(error).toBeNull()
    expect(data).toBeTruthy()
    expect(data.order_number).toMatch(/^224-/)
    expect(data.total).toBeGreaterThan(0)
    expect(data.status).toBe('pending')

    orderNumber = data.order_number
    placedTotal = data.total

    // Email-lock + ownership contract, verified with the service-role client.
    const { data: row } = await admin
      .from('orders')
      .select('user_id, customer_email')
      .eq('order_number', orderNumber)
      .single()
    expect(row?.user_id).toBe(testUserId)
    expect(row?.customer_email).toBe(testUserEmail)

    // The units really left inventory.
    const { data: prod } = await admin
      .from('products')
      .select('stock_quantity')
      .eq('id', productId)
      .single()
    expect(prod?.stock_quantity).toBe(START_STOCK - TEST_QTY)
  })

  it('POSITIVE: the customer reads their own order via RLS (orders_owner_select)', async () => {
    expect(orderNumber).toBeTruthy()
    const { data, error } = await userClient
      .from('orders')
      .select('order_number, status, total')
      .eq('order_number', orderNumber)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data[0].total).toBe(placedTotal)
  })

  it('POSITIVE: anon get_order_tracking with correct email returns the pending order', async () => {
    expect(orderNumber).toBeTruthy()
    const { data, error } = await anon.rpc('get_order_tracking', {
      p_order_number: orderNumber,
      p_email: testUserEmail,
    })
    expect(error).toBeNull()
    expect(data).not.toBeNull()
    expect(data.order_number).toBe(orderNumber)
    expect(data.status).toBe('pending')
    expect(data.total).toBe(placedTotal)
  })

  it('NEGATIVE: get_order_tracking with WRONG email returns null (no enumeration)', async () => {
    expect(orderNumber).toBeTruthy()
    const { data, error } = await anon.rpc('get_order_tracking', {
      p_order_number: orderNumber,
      p_email: 'wrong+attacker@example.com',
    })
    expect(error).toBeNull()
    // Email is the shared secret — a mismatch must yield no row.
    expect(data).toBeNull()
  })

  it('NEGATIVE: an authenticated NON-admin cannot call admin_update_order_status', async () => {
    expect(orderNumber).toBeTruthy()
    const { data: row } = await admin
      .from('orders')
      .select('id')
      .eq('order_number', orderNumber)
      .single()
    expect(row?.id).toBeTruthy()

    // The customer holds the `authenticated` role, so the grant alone doesn't
    // protect this RPC — is_admin() inside it must raise 'Not authorized'.
    const { data, error } = await userClient.rpc('admin_update_order_status', {
      p_order_id: row.id,
      p_status: 'confirmed',
    })
    expect(error).not.toBeNull()
    expect(data).toBeNull()

    // Confirm the status was NOT changed under the hood.
    const { data: after } = await admin
      .from('orders')
      .select('status')
      .eq('order_number', orderNumber)
      .single()
    expect(after?.status).toBe('pending')
  })
})

describe.skipIf(!SKIP)('COD contract skipped (need VITE_SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY)', () => {
  it('reminds devs how to enable the COD contract test', () => {
    expect(true).toBe(true)
  })
})
