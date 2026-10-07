/**
 * Live-DB contract test for 20261007150000_driver_portal.
 *
 *   NEGATIVE — a driver can't see orders not assigned to them; a customer
 *              can't call driver RPCs.
 *   POSITIVE — the assigned driver sees the order and starts the delivery.
 *   NEGATIVE — no location is stored while the driver has nothing en route.
 *   POSITIVE — location is stored en route; the customer sees it with order
 *              number + email; a wrong email sees nothing.
 *   POSITIVE — completing the delivery marks it delivered and deletes the
 *              driver's position.
 *   NEGATIVE — an unpaid EFT order can't be started by the driver.
 *
 *   npx vitest run src/__tests__/driverPortal.contract.test.js
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  anonClient, serviceClient, probeMigration, describeGate,
  testSlug, createTestUser, signInAs, deleteTestUsers, mustSucceed, grantPendingMembership,
} from './helpers/liveFixtures.js'

const gate = await probeMigration({
  migration: '20261007150000_driver_portal',
  label: 'is_driver()',
  probe: () => anonClient().rpc('is_driver'),
})
const SKIP = !gate.applied

const admin = SKIP ? null : serviceClient()
const buyer = SKIP ? null : anonClient()
const driver = SKIP ? null : anonClient()
const otherDriver = SKIP ? null : anonClient()
const adminClient = SKIP ? null : anonClient()
const anon = SKIP ? null : anonClient()

const SLUG = testSlug('driver-product')
let productId, buyerUser, driverUser, otherDriverUser, adminUser
let codOrder, eftOrder

const customer = (email) => ({
  name: 'Vitest Delivery', email, phone: '0000000000', street: '1 Test St',
  apartment: '', city: 'Boksburg', province: 'Gauteng', postalCode: '1459',
})

describe.skipIf(SKIP)('Driver portal contract', () => {
  beforeAll(async () => {
    productId = mustSucceed('product', await admin.from('products').insert({
      name: `Vitest Driver ${SLUG}`, slug: SLUG, price: 10000, category: 'accessories', stock_quantity: 5, is_available: true,
    }).select('id').single()).id

    buyerUser = await createTestUser(admin, 'drv-buyer')
    driverUser = await createTestUser(admin, 'drv-driver')
    otherDriverUser = await createTestUser(admin, 'drv-other')
    adminUser = await createTestUser(admin, 'drv-admin')
    await grantPendingMembership(admin, buyerUser) // two orders
    mustSucceed('grant admin', await admin.from('admin_users').insert({ id: adminUser.id, email: adminUser.email }))
    mustSucceed('drivers', await admin.from('drivers').insert([
      { user_id: driverUser.id, full_name: 'Vitest Driver' },
      { user_id: otherDriverUser.id, full_name: 'Vitest Other' },
    ]))
    await signInAs(buyer, buyerUser.email)
    await signInAs(driver, driverUser.email)
    await signInAs(otherDriver, otherDriverUser.email)
    await signInAs(adminClient, adminUser.email)

    const place = async (method) => {
      const { data, error } = await buyer.rpc('place_cod_order', {
        p_customer: customer(buyerUser.email), p_items: [{ id: productId, quantity: 1 }], p_payment_method: method,
      })
      expect(error).toBeNull()
      return data
    }
    codOrder = await place('cash_on_delivery')
    eftOrder = await place('eft')
    for (const o of [codOrder, eftOrder]) {
      const { error } = await adminClient.rpc('admin_assign_driver', { p_order_id: o.id, p_driver_id: driverUser.id })
      expect(error).toBeNull()
    }
  })

  afterAll(async () => {
    if (!admin) return
    const emails = [buyerUser?.email, driverUser?.email, otherDriverUser?.email, adminUser?.email].filter(Boolean)
    if (emails.length) await admin.from('orders').delete().in('customer_email', emails)
    if (emails.length) await admin.from('memberships').delete().in('email', emails)
    await admin.from('products').delete().eq('slug', SLUG)
    await deleteTestUsers(admin, buyerUser?.id, driverUser?.id, otherDriverUser?.id, adminUser?.id)
  })

  it('is_driver is true for drivers only', async () => {
    expect((await driver.rpc('is_driver')).data).toBe(true)
    expect((await buyer.rpc('is_driver')).data).toBe(false)
  })

  it('admins are drivers too (20261007160000)', async () => {
    expect((await adminClient.rpc('is_driver')).data).toBe(true)
  })

  it('NEGATIVE: another driver cannot see the order', async () => {
    const { data } = await otherDriver.from('orders').select('id').eq('id', codOrder.id)
    expect(data).toEqual([])
  })

  it('POSITIVE: the assigned driver sees it with address and phone', async () => {
    const { data, error } = await driver.from('orders').select('id, customer_phone, shipping_address').eq('id', codOrder.id)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data[0].customer_phone).toBe('0000000000')
  })

  it('NEGATIVE: nothing en route, so no location is stored', async () => {
    const { data, error } = await driver.rpc('driver_update_location', { p_lat: -26.2, p_lng: 28.26 })
    expect(error).toBeNull()
    // Returns { stored, nearby } since 20261008140000_delivery_eta.
    expect(data.stored).toBe(false)
  })

  it('NEGATIVE: a customer cannot call driver RPCs', async () => {
    const a = await buyer.rpc('driver_update_location', { p_lat: -26.2, p_lng: 28.26 })
    expect(a.error?.message).toMatch(/not authorized/i)
    const b = await buyer.rpc('driver_start_delivery', { p_order_id: codOrder.id })
    expect(b.error?.message).toMatch(/not authorized/i)
  })

  it('NEGATIVE: an unpaid EFT order cannot be started', async () => {
    const { error } = await driver.rpc('driver_start_delivery', { p_order_id: eftOrder.id })
    expect(error?.message).toMatch(/EFT payment not confirmed/i)
  })

  it('POSITIVE: start, share location, customer sees it', async () => {
    expect((await driver.rpc('driver_start_delivery', { p_order_id: codOrder.id })).error).toBeNull()
    const stored = await driver.rpc('driver_update_location', { p_lat: -26.21, p_lng: 28.25, p_accuracy: 12 })
    expect(stored.data.stored).toBe(true)

    const seen = await anon.rpc('get_delivery_location', { p_order_number: codOrder.order_number, p_email: buyerUser.email })
    expect(seen.error).toBeNull()
    expect(seen.data).toMatchObject({ lat: -26.21, lng: 28.25, driver_first_name: 'Vitest' })

    const wrong = await anon.rpc('get_delivery_location', { p_order_number: codOrder.order_number, p_email: 'nobody@example.com' })
    expect(wrong.data).toBeNull()

    const fleet = await adminClient.rpc('admin_driver_locations')
    expect(fleet.data.some(d => d.driver_id === driverUser.id)).toBe(true)
  })

  it('NEGATIVE: anon cannot read driver_locations directly', async () => {
    const { data } = await anon.from('driver_locations').select('*')
    expect(data ?? []).toEqual([])
  })

  it('POSITIVE: completing the delivery clears the driver position', async () => {
    expect((await driver.rpc('driver_complete_delivery', { p_order_id: codOrder.id })).error).toBeNull()
    const row = mustSucceed('order', await admin.from('orders').select('status').eq('id', codOrder.id).single())
    expect(row.status).toBe('delivered')
    const { data } = await admin.from('driver_locations').select('driver_id').eq('driver_id', driverUser.id)
    expect(data).toEqual([])
  })
})

describeGate('Driver portal contract', gate)
