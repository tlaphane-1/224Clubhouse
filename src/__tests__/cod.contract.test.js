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
 * users hold: a throwaway CONFIRMED customer account (created/destroyed with
 * the service-role admin API) plus the plain ANON key. Key controls:
 *   NEGATIVE — anon can NO LONGER place an order (account requirement).
 *   POSITIVE — a signed-in customer places an order; the row carries their
 *              user_id and their ACCOUNT email (client email is ignored).
 *   POSITIVE — the customer reads their own order through RLS.
 *   POSITIVE — anon tracking by number + email still works (old orders).
 *   NEGATIVE — tracking with the WRONG email returns null (no enumeration).
 *   NEGATIVE — an authenticated NON-admin cannot update order status.
 *
 * Because it MUTATES (creates a user + an order, decrements stock), afterAll
 * cleans up with the service-role client: deletes the test order(s) and user,
 * and adds the consumed stock back. Idempotent — leftovers are purged first.
 *
 * Auto-skips unless BOTH VITE_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY
 * are set (service role is required for safe cleanup, so we don't mutate the
 * DB without a way to undo it).
 *
 * How to run (PowerShell):
 *   npx vitest run src/__tests__/cod.contract.test.js
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const URL =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  'https://aogdkqczvlffgydgxsmz.supabase.co'
const ANON = process.env.VITE_SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
const SKIP = !ANON || !SERVICE

// Clearly-marked test identity so cleanup can target exactly our rows.
const TEST_EMAIL = 'vitest+cod@example.com'
const TEST_PASSWORD = 'vitest-cod-3x9!Local'
const TEST_QTY = 1

const anon = SKIP
  ? null
  : createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } })
const admin = SKIP
  ? null
  : createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })
// Signed in as the test customer in beforeAll — the role real buyers hold.
const userClient = SKIP
  ? null
  : createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } })

// Shared state across the ordered tests.
let product = null      // the product we ordered (for stock restore)
let testUserId = null   // auth.users id of the throwaway customer
let orderNumber = null  // returned by place_cod_order
let placedTotal = 0

// Remove any leftover orders from a prior crashed run for our test email.
async function purgeTestOrders() {
  await admin.from('orders').delete().eq('customer_email', TEST_EMAIL)
}

// Remove any leftover auth user from a prior crashed run.
async function purgeTestUser() {
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  const leftover = data?.users?.find((u) => u.email === TEST_EMAIL)
  if (leftover) await admin.auth.admin.deleteUser(leftover.id)
}

describe.skipIf(SKIP)('COD contract — account-required ordering + tracking RPCs', () => {
  beforeAll(async () => {
    await purgeTestOrders()
    await purgeTestUser()

    // A confirmed customer account (email confirmation is ON in this project,
    // so bypass it with the admin API rather than clicking a link).
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      email_confirm: true,
    })
    expect(createErr).toBeNull()
    testUserId = created.user.id

    const { error: signInErr } = await userClient.auth.signInWithPassword({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    })
    expect(signInErr).toBeNull()

    // Fetch one real, available product via the ANON client (what a visitor sees).
    const { data, error } = await anon
      .from('products')
      .select('id, name, price, stock_quantity, is_available')
      .eq('is_available', true)
      .gte('stock_quantity', TEST_QTY)
      .limit(1)
    expect(error).toBeNull()
    expect(Array.isArray(data) && data.length === 1).toBe(true)
    product = data[0]
  })

  afterAll(async () => {
    if (!admin) return
    // Delete the order(s) we created.
    await purgeTestOrders()
    // Restore the stock we consumed so seeded data is unchanged.
    if (product) {
      const { data: cur } = await admin
        .from('products')
        .select('stock_quantity')
        .eq('id', product.id)
        .single()
      if (cur) {
        await admin
          .from('products')
          .update({ stock_quantity: cur.stock_quantity + TEST_QTY })
          .eq('id', product.id)
      }
    }
    // Delete the throwaway customer.
    if (testUserId) await admin.auth.admin.deleteUser(testUserId)
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
    p_items: [{ id: product.id, quantity: TEST_QTY }],
    p_payment_method: 'cash_on_delivery',
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
    expect(row?.customer_email).toBe(TEST_EMAIL)
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
      p_email: TEST_EMAIL,
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
