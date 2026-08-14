/**
 * Live-DB contract test for restock-on-cancel (Layer 1 + 2).
 *
 * Covers migration 20260814101000_restock_on_cancel: place_cod_order takes
 * units OUT of products.stock_quantity, and until this migration
 * admin_update_order_status never put them back — every cancellation
 * permanently shrank inventory. The contract now is:
 *
 *   POSITIVE — placing an order decrements stock (the pre-condition of the bug).
 *   POSITIVE — an admin cancelling it returns the exact units to stock.
 *   POSITIVE — the status_history entry records what was restored.
 *   NEGATIVE — cancelling an ALREADY-cancelled order restocks nothing
 *              (idempotency; the order row lock is what guarantees it).
 *   NEGATIVE — 'delivered' -> 'cancelled' does NOT restock (the goods left the
 *              building; a phantom unit would oversell). The cancellation still
 *              succeeds and says so in the history note.
 *
 * REQUIRES migration 20260814101000 to be applied. The fix lives inside an
 * existing function signature, so — same reasoning as membership.contract —
 * the suite probes the migration's marker RPC `order_cancel_restocks()` at
 * module load and auto-skips if it isn't there yet, rather than failing
 * against the old (stock-destroying) behaviour.
 *
 * Because it MUTATES (creates a product, a customer, an ADMIN user, orders and
 * moves stock), afterAll cleans up with the service-role client: the product is
 * ours and is deleted outright, so no seeded stock is touched. Idempotent —
 * leftovers are purged first.
 *
 * Auto-skips unless BOTH VITE_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY
 * are set (service role is required for safe cleanup, so we don't mutate the
 * DB without a way to undo it).
 *
 * How to run (PowerShell):
 *   npx vitest run src/__tests__/restock.contract.test.js
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const URL =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  'https://aogdkqczvlffgydgxsmz.supabase.co'
const ANON = process.env.VITE_SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
const KEYS_MISSING = !ANON || !SERVICE

// Migration probe: order_cancel_restocks() exists only once 20260814101000 is
// applied (a missing RPC is a PostgREST PGRST202 error). Top-level await is
// fine here — vitest test modules are ESM and the env setup file has already
// populated process.env.
let MIGRATED = false
if (!KEYS_MISSING) {
  const probe = createClient(URL, ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await probe.rpc('order_cancel_restocks')
  MIGRATED = !error && data === true
}
const SKIP = KEYS_MISSING || !MIGRATED

// Clearly-marked test identities so cleanup can target exactly our rows.
const TEST_EMAIL = 'vitest+restock@example.com'
const ADMIN_EMAIL = 'vitest+restock-admin@example.com'
const TEST_PASSWORD = 'vitest-restock-5q8!Local'

// Our own throwaway product — deleted in afterAll, so no seeded stock moves.
const TEST_PRODUCT_SLUG = 'vitest-restock-product'
const START_STOCK = 7
const ORDER_QTY = 2
const SECOND_QTY = 1

const admin = SKIP
  ? null
  : createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })
// Signed in as the buyer — the role real customers hold.
const userClient = SKIP
  ? null
  : createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } })
// Signed in as a REAL admin (a row in admin_users), so is_admin() passes and
// admin_update_order_status runs the way it does in the admin UI.
const adminClient = SKIP
  ? null
  : createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } })

// Shared state across the ordered tests.
let productId = null
let testUserId = null
let adminUserId = null
let orderId = null
let secondOrderId = null

async function purgeTestOrders() {
  await admin.from('orders').delete().in('customer_email', [TEST_EMAIL, ADMIN_EMAIL])
}

async function purgeTestProduct() {
  await admin.from('products').delete().eq('slug', TEST_PRODUCT_SLUG)
}

async function purgeTestUsers() {
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  for (const u of data?.users ?? []) {
    if (u.email === TEST_EMAIL || u.email === ADMIN_EMAIL) {
      // admin_users.id references auth.users on delete cascade, so removing
      // the user also removes any admin grant we made.
      await admin.auth.admin.deleteUser(u.id)
    }
  }
}

async function stockNow() {
  const { data, error } = await admin
    .from('products')
    .select('stock_quantity')
    .eq('id', productId)
    .single()
  expect(error).toBeNull()
  return data.stock_quantity
}

async function orderRow(id) {
  const { data, error } = await admin
    .from('orders')
    .select('status, status_history')
    .eq('id', id)
    .single()
  expect(error).toBeNull()
  return data
}

const lastNote = (row) => {
  const history = Array.isArray(row?.status_history) ? row.status_history : []
  return history.length ? (history[history.length - 1].note ?? '') : ''
}

const orderPayload = (quantity) => ({
  p_customer: {
    name: 'Vitest Restock',
    email: TEST_EMAIL,
    phone: '0000000000',
    street: '1 Test St',
    apartment: '',
    city: 'Boksburg',
    province: 'Gauteng',
    postalCode: '1459',
  },
  p_items: [{ id: productId, quantity }],
  p_payment_method: 'cash_on_delivery',
})

describe.skipIf(SKIP)('Restock contract — cancelling an order returns its stock', () => {
  beforeAll(async () => {
    await purgeTestOrders()
    await purgeTestUsers()
    await purgeTestProduct()

    const { data: prod, error: ep } = await admin
      .from('products')
      .insert({
        name: 'Vitest Restock Product',
        slug: TEST_PRODUCT_SLUG,
        price: 10000,
        category: 'accessories',
        stock_quantity: START_STOCK,
        is_available: true,
      })
      .select('id')
      .single()
    expect(ep).toBeNull()
    productId = prod.id

    // Confirmed accounts (email confirmation is ON in this project, so bypass
    // it with the admin API rather than clicking a link).
    const { data: buyer, error: e1 } = await admin.auth.admin.createUser({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      email_confirm: true,
    })
    expect(e1).toBeNull()
    testUserId = buyer.user.id

    const { data: adm, error: e2 } = await admin.auth.admin.createUser({
      email: ADMIN_EMAIL,
      password: TEST_PASSWORD,
      email_confirm: true,
    })
    expect(e2).toBeNull()
    adminUserId = adm.user.id

    // admin_users has no write policies — only the service role can grant.
    const { error: eGrant } = await admin
      .from('admin_users')
      .insert({ id: adminUserId, email: ADMIN_EMAIL })
    expect(eGrant).toBeNull()

    const { error: s1 } = await userClient.auth.signInWithPassword({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    })
    expect(s1).toBeNull()
    const { error: s2 } = await adminClient.auth.signInWithPassword({
      email: ADMIN_EMAIL,
      password: TEST_PASSWORD,
    })
    expect(s2).toBeNull()
  })

  afterAll(async () => {
    if (!admin) return
    await purgeTestOrders()
    await purgeTestProduct()
    if (testUserId) await admin.auth.admin.deleteUser(testUserId)
    if (adminUserId) await admin.auth.admin.deleteUser(adminUserId)
  })

  it('POSITIVE: placing an order decrements stock (the units the bug used to eat)', async () => {
    const { data, error } = await userClient.rpc('place_cod_order', orderPayload(ORDER_QTY))
    expect(error).toBeNull()
    expect(data?.order_number).toMatch(/^224-/)

    const { data: row } = await admin
      .from('orders')
      .select('id, status')
      .eq('order_number', data.order_number)
      .single()
    orderId = row.id
    expect(row.status).toBe('pending')

    expect(await stockNow()).toBe(START_STOCK - ORDER_QTY)
  })

  it('POSITIVE: an admin cancelling the order returns the exact units to stock', async () => {
    expect(orderId).toBeTruthy()
    const { data, error } = await adminClient.rpc('admin_update_order_status', {
      p_order_id: orderId,
      p_status: 'cancelled',
    })
    expect(error).toBeNull()
    expect(data?.status).toBe('cancelled')
    expect(data?.restocked_units).toBe(ORDER_QTY)

    expect(await stockNow()).toBe(START_STOCK)
  })

  it('POSITIVE: the status_history entry records the restock for the admin to see', async () => {
    const row = await orderRow(orderId)
    expect(row.status).toBe('cancelled')
    expect(lastNote(row)).toMatch(/stock restored/i)
  })

  it('NEGATIVE: cancelling an ALREADY-cancelled order does not inflate stock', async () => {
    const before = await stockNow()
    expect(before).toBe(START_STOCK)

    const { data, error } = await adminClient.rpc('admin_update_order_status', {
      p_order_id: orderId,
      p_status: 'cancelled',
    })
    expect(error).toBeNull()
    expect(data?.status).toBe('cancelled')
    // Nothing credited the second time — the order row lock + status re-read.
    expect(data?.restocked_units).toBe(0)

    expect(await stockNow()).toBe(START_STOCK)
  })

  it('NEGATIVE: delivered -> cancelled does NOT restock (the goods already left)', async () => {
    const { data: placed, error: ePlace } = await userClient.rpc(
      'place_cod_order',
      orderPayload(SECOND_QTY),
    )
    expect(ePlace).toBeNull()

    const { data: row } = await admin
      .from('orders')
      .select('id')
      .eq('order_number', placed.order_number)
      .single()
    secondOrderId = row.id
    expect(await stockNow()).toBe(START_STOCK - SECOND_QTY)

    const { error: eDeliver } = await adminClient.rpc('admin_update_order_status', {
      p_order_id: secondOrderId,
      p_status: 'delivered',
    })
    expect(eDeliver).toBeNull()
    expect(await stockNow()).toBe(START_STOCK - SECOND_QTY)

    const { data: cancelled, error: eCancel } = await adminClient.rpc(
      'admin_update_order_status',
      { p_order_id: secondOrderId, p_status: 'cancelled' },
    )
    // The cancellation itself must still succeed...
    expect(eCancel).toBeNull()
    expect(cancelled?.status).toBe('cancelled')
    // ...but no phantom units appear.
    expect(cancelled?.restocked_units).toBe(0)
    expect(await stockNow()).toBe(START_STOCK - SECOND_QTY)

    // And the admin is told why, in the place they already look.
    expect(lastNote(await orderRow(secondOrderId))).toMatch(/NOT restored/i)
  })
})

describe.skipIf(!SKIP)('Restock contract skipped', () => {
  it('reminds devs why (missing keys, or migration 20260814101000 not pushed yet)', () => {
    expect(true).toBe(true)
  })
})
