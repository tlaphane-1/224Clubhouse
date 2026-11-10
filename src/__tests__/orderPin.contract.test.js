/**
 * Live-DB contract test for 20261110120000_order_location_pin.
 *
 *   POSITIVE — the customer pins their own new order; the row carries it.
 *   NEGATIVE — a second pin on the same order is refused (no moving it later).
 *   NEGATIVE — another signed-in customer cannot pin someone else's order.
 *   NEGATIVE — anon cannot call set_order_pin at all.
 *   NEGATIVE — an impossible position is refused.
 *   NEGATIVE — an order older than 15 minutes can no longer be pinned.
 *
 *   npx vitest run src/__tests__/orderPin.contract.test.js
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  anonClient, serviceClient, probeMigration, describeGate,
  testSlug, createTestUser, signInAs, deleteTestUsers, mustSucceed, grantPendingMembership,
} from './helpers/liveFixtures.js'

const gate = await probeMigration({
  migration: '20261110120000_order_location_pin',
  label: 'orders.pin_lat',
  probe: () => serviceClient().from('orders').select('pin_lat').limit(1),
})
const SKIP = !gate.applied
describeGate('Order location pin contract', gate)

const admin = SKIP ? null : serviceClient()
const buyer = SKIP ? null : anonClient()
const other = SKIP ? null : anonClient()
const anon = SKIP ? null : anonClient()

const SLUG = testSlug('pin-product')
const PIN = { lat: -25.5197, lng: 28.1003 } // Soshanguve
let productId, buyerUser, otherUser

async function placeOrder() {
  const { data, error } = await buyer.rpc('place_cod_order', {
    p_customer: {
      name: 'Vitest Pin', email: buyerUser.email, phone: '0000000000', street: '1 Test St',
      apartment: '', city: 'Soshanguve', province: 'Gauteng', postalCode: '0152',
    },
    p_items: [{ id: productId, quantity: 1 }],
    p_payment_method: 'cash_on_delivery',
  })
  expect(error).toBeNull()
  return data
}

describe.skipIf(SKIP)('Order location pin contract', () => {
  beforeAll(async () => {
    productId = mustSucceed('product', await admin.from('products').insert({
      name: `Vitest Pin ${SLUG}`, slug: SLUG, price: 10000, category: 'accessories', stock_quantity: 5, is_available: true,
    }).select('id').single()).id
    buyerUser = await createTestUser(admin, 'pin-buyer')
    otherUser = await createTestUser(admin, 'pin-other')
    await signInAs(buyer, buyerUser.email)
    await signInAs(other, otherUser.email)
    // The second order would otherwise need a membership (place_cod_order).
    await grantPendingMembership(admin, buyerUser)
  })

  afterAll(async () => {
    if (!admin) return
    if (buyerUser) {
      await admin.from('orders').delete().eq('customer_email', buyerUser.email)
      await admin.from('memberships').delete().eq('email', buyerUser.email)
    }
    await admin.from('products').delete().eq('slug', SLUG)
    await deleteTestUsers(admin, buyerUser?.id, otherUser?.id)
  })

  it('the customer pins their own new order, once', async () => {
    const order = await placeOrder()
    const pin = await buyer.rpc('set_order_pin', { p_order_id: order.id, p_lat: PIN.lat, p_lng: PIN.lng, p_accuracy_m: 12 })
    expect(pin.error).toBeNull()

    const row = mustSucceed('read', await buyer.from('orders').select('pin_lat, pin_lng, pin_accuracy_m, pin_at').eq('id', order.id).single())
    expect(row.pin_lat).toBeCloseTo(PIN.lat, 6)
    expect(row.pin_lng).toBeCloseTo(PIN.lng, 6)
    expect(row.pin_accuracy_m).toBe(12)
    expect(row.pin_at).toBeTruthy()

    const again = await buyer.rpc('set_order_pin', { p_order_id: order.id, p_lat: 0, p_lng: 0 })
    expect(again.error?.message).toMatch(/Order not found/)
  })

  it("another customer cannot pin someone else's order, and anon cannot call it", async () => {
    const order = await placeOrder()
    const theirs = await other.rpc('set_order_pin', { p_order_id: order.id, p_lat: PIN.lat, p_lng: PIN.lng })
    expect(theirs.error?.message).toMatch(/Order not found/)

    const anonCall = await anon.rpc('set_order_pin', { p_order_id: order.id, p_lat: PIN.lat, p_lng: PIN.lng })
    expect(anonCall.error).not.toBeNull()

    const row = mustSucceed('read', await admin.from('orders').select('pin_at').eq('id', order.id).single())
    expect(row.pin_at).toBeNull()
  })

  it('refuses an impossible position and an order older than 15 minutes', async () => {
    const order = await placeOrder()
    const bad = await buyer.rpc('set_order_pin', { p_order_id: order.id, p_lat: 120, p_lng: PIN.lng })
    expect(bad.error?.message).toMatch(/Invalid location/)

    mustSucceed('age the order', await admin.from('orders')
      .update({ created_at: new Date(Date.now() - 16 * 60 * 1000).toISOString() }).eq('id', order.id))
    const late = await buyer.rpc('set_order_pin', { p_order_id: order.id, p_lat: PIN.lat, p_lng: PIN.lng })
    expect(late.error?.message).toMatch(/Order not found/)
  })
})
