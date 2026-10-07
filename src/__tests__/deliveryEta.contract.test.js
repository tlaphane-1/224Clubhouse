/**
 * Live-DB contract test for 20261008140000_delivery_eta.
 *
 *   POSITIVE — distance_m() gives sane metres for a known pair.
 *   POSITIVE — driver_update_location returns {stored, nearby}.
 *   POSITIVE — once the order has a destination and the driver is within 1 km,
 *              `nearby` reports the order exactly once (no repeat on the next
 *              update), and nearby_notified_at is set.
 *   NEGATIVE — far from the destination, nothing is reported.
 *   POSITIVE — get_delivery_location returns the destination and distance.
 *
 *   npx vitest run src/__tests__/deliveryEta.contract.test.js
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  anonClient, serviceClient, probeMigration, describeGate,
  testSlug, createTestUser, signInAs, deleteTestUsers, mustSucceed,
} from './helpers/liveFixtures.js'

const gate = await probeMigration({
  migration: '20261008140000_delivery_eta',
  label: 'distance_m()',
  probe: () => anonClient().rpc('distance_m', { lat1: 0, lng1: 0, lat2: 0, lng2: 0 }),
})
const SKIP = !gate.applied

const admin = SKIP ? null : serviceClient()
const buyer = SKIP ? null : anonClient()
const driver = SKIP ? null : anonClient()
const anon = SKIP ? null : anonClient()

const SLUG = testSlug('eta-product')
// Destination in Boksburg CBD; "far" ~4.4 km away in Libradene; "near" ~300 m.
const DEST = { lat: -26.2125, lng: 28.2625 }
const FAR = { lat: -26.2470, lng: 28.2405 }
const NEAR = { lat: -26.2150, lng: 28.2620 }
let productId, buyerUser, driverUser, order

describe.skipIf(SKIP)('Delivery ETA contract', () => {
  beforeAll(async () => {
    productId = mustSucceed('product', await admin.from('products').insert({
      name: `Vitest ETA ${SLUG}`, slug: SLUG, price: 10000, category: 'accessories', stock_quantity: 3, is_available: true,
    }).select('id').single()).id
    buyerUser = await createTestUser(admin, 'eta-buyer')
    driverUser = await createTestUser(admin, 'eta-driver')
    mustSucceed('driver', await admin.from('drivers').insert({ user_id: driverUser.id, full_name: 'Vitest Eta' }))
    await signInAs(buyer, buyerUser.email)
    await signInAs(driver, driverUser.email)

    const { data, error } = await buyer.rpc('place_cod_order', {
      p_customer: {
        name: 'Vitest ETA', email: buyerUser.email, phone: '0000000000', street: '1 Test St',
        apartment: '', city: 'Boksburg', province: 'Gauteng', postalCode: '1459',
      },
      p_items: [{ id: productId, quantity: 1 }],
      p_payment_method: 'cash_on_delivery',
    })
    expect(error).toBeNull()
    order = data
    mustSucceed('assign', await admin.from('orders').update({ driver_id: driverUser.id }).eq('id', order.id))
    expect((await driver.rpc('driver_start_delivery', { p_order_id: order.id })).error).toBeNull()
  })

  afterAll(async () => {
    if (!admin) return
    if (buyerUser) await admin.from('orders').delete().eq('customer_email', buyerUser.email)
    await admin.from('products').delete().eq('slug', SLUG)
    await deleteTestUsers(admin, buyerUser?.id, driverUser?.id)
  })

  it('distance_m: Libradene -> Boksburg CBD is ~4.4 km', async () => {
    const { data, error } = await anon.rpc('distance_m', { lat1: FAR.lat, lng1: FAR.lng, lat2: DEST.lat, lng2: DEST.lng })
    expect(error).toBeNull()
    expect(data).toBeGreaterThan(4300)
    expect(data).toBeLessThan(4550)
  })

  it('returns {stored, nearby}; nothing nearby without a destination', async () => {
    const { data, error } = await driver.rpc('driver_update_location', { p_lat: NEAR.lat, p_lng: NEAR.lng })
    expect(error).toBeNull()
    expect(data).toEqual({ stored: true, nearby: [] })
  })

  it('NEGATIVE: far from the destination, nothing is reported', async () => {
    mustSucceed('set dest', await admin.from('orders').update({ dest_lat: DEST.lat, dest_lng: DEST.lng }).eq('id', order.id))
    const { data } = await driver.rpc('driver_update_location', { p_lat: FAR.lat, p_lng: FAR.lng })
    expect(data.nearby).toEqual([])
  })

  it('POSITIVE: within 1 km the order is reported once', async () => {
    const first = await driver.rpc('driver_update_location', { p_lat: NEAR.lat, p_lng: NEAR.lng })
    expect(first.data.nearby).toEqual([order.id])
    const second = await driver.rpc('driver_update_location', { p_lat: NEAR.lat, p_lng: NEAR.lng })
    expect(second.data.nearby).toEqual([])
    const row = mustSucceed('order', await admin.from('orders').select('nearby_notified_at').eq('id', order.id).single())
    expect(row.nearby_notified_at).toBeTruthy()
  })

  it('POSITIVE: the customer sees destination and distance', async () => {
    const { data, error } = await anon.rpc('get_delivery_location', { p_order_number: order.order_number, p_email: buyerUser.email })
    expect(error).toBeNull()
    expect(data).toMatchObject({ dest_lat: DEST.lat, dest_lng: DEST.lng })
    expect(data.distance_m).toBeGreaterThan(200)
    expect(data.distance_m).toBeLessThan(400)
  })
})

describeGate('Delivery ETA contract', gate)
