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
 * REQUIRES migration 20260814101000. The fix lives inside an existing function
 * signature, so the suite probes the migration's marker RPC
 * `order_cancel_restocks()` at module load. `probeMigration` separates "RPC
 * genuinely absent" (a clean skip) from "the probe broke" (a LOUD failure) —
 * the old `MIGRATED = !err && data === true` form silently skipped the suite on
 * any transient error, leaving the run green while the stock-destroying
 * behaviour went untested.
 *
 * ISOLATION: the buyer account, the ADMIN account and the product all carry
 * RUN_TAG, so a concurrent or orphaned vitest run cannot delete them mid-test.
 * The product is ours and is deleted outright, so no seeded stock is touched.
 *
 * Auto-skips unless BOTH VITE_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY
 * are set (service role is required for safe cleanup, so we don't mutate the
 * DB without a way to undo it).
 *
 * How to run (PowerShell):
 *   npx vitest run src/__tests__/restock.contract.test.js
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  anonClient, serviceClient, probeMigration, describeGate,
  testSlug, createTestUser, signInAs, deleteTestUsers, mustSucceed,
} from './helpers/liveFixtures.js'

// A marker RPC that returns true only once the migration is applied. A missing
// function is PGRST202, which probeMigration classifies as "not applied".
const gate = await probeMigration({
  migration: '20260814101000_restock_on_cancel',
  label: 'order_cancel_restocks()',
  probe: async () => {
    const res = await anonClient().rpc('order_cancel_restocks')
    if (res.error) return res
    // The RPC resolved but reported the old behaviour — a real "not applied".
    return res.data === true
      ? res
      : { data: null, error: { code: 'PGRST202', message: 'order_cancel_restocks() returned false' } }
  },
})
const SKIP = !gate.applied

// Our own throwaway product — deleted in afterAll, so no seeded stock moves.
const TEST_PRODUCT_SLUG = testSlug('restock-product')
const START_STOCK = 7
const ORDER_QTY = 2
const SECOND_QTY = 1

const admin = SKIP ? null : serviceClient()
// Signed in as the buyer — the role real customers hold.
const userClient = SKIP ? null : anonClient()
// Signed in as a REAL admin (a row in admin_users), so is_admin() passes and
// admin_update_order_status runs the way it does in the admin UI.
const adminClient = SKIP ? null : anonClient()

// Shared state across the ordered tests.
let productId = null
let testUserId = null
let testUserEmail = null
let adminUserId = null
let adminUserEmail = null
let orderId = null
let secondOrderId = null

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
    email: testUserEmail,
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
    const prod = mustSucceed('create test product', await admin
      .from('products')
      .insert({
        name: `Vitest Restock Product ${TEST_PRODUCT_SLUG}`,
        slug: TEST_PRODUCT_SLUG,
        price: 10000,
        category: 'accessories',
        stock_quantity: START_STOCK,
        is_available: true,
      })
      .select('id')
      .single())
    productId = prod.id

    const buyer = await createTestUser(admin, 'restock')
    testUserId = buyer.id
    testUserEmail = buyer.email

    const adm = await createTestUser(admin, 'restock-admin')
    adminUserId = adm.id
    adminUserEmail = adm.email

    // admin_users has no write policies — only the service role can grant.
    mustSucceed('grant admin to the test admin account', await admin
      .from('admin_users')
      .insert({ id: adminUserId, email: adminUserEmail }))

    await signInAs(userClient, testUserEmail)
    await signInAs(adminClient, adminUserEmail)
  })

  afterAll(async () => {
    if (!admin) return
    const emails = [testUserEmail, adminUserEmail].filter(Boolean)
    // Orders first — a stray test order would show up in the admin dashboard's
    // order count and revenue tiles as a real sale.
    if (emails.length) await admin.from('orders').delete().in('customer_email', emails)
    await admin.from('products').delete().eq('slug', TEST_PRODUCT_SLUG)
    // admin_users.id references auth.users on delete cascade, so removing the
    // user also removes the admin grant made above.
    await deleteTestUsers(admin, testUserId, adminUserId)
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

describeGate('Restock contract', gate)
