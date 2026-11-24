/**
 * Live-DB contract test for 20261124120000_collect_fulfilment.
 *
 * A store in 'collect' mode takes orders for collection at the club:
 *   POSITIVE — an order ignores any address the client sends and charges no fee.
 *   NEGATIVE — set_order_pin is refused (no location data is collected).
 *   NEGATIVE — an active driver row does not make anyone a driver, so the
 *              driver RPCs refuse.
 *   REGRESSION — a 'delivery' store (224) still charges R30 under R500 and keeps
 *              the address.
 *
 * Uses its own store 'vitest-c' (collect) rather than flipping the shared
 * 'vitest-b', so suites running in parallel never see the mode change.
 *
 *   npm run test:local -- src/__tests__/collectFulfilment.contract.test.js
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  anonClient, serviceClient, probeMigration, describeGate, mustSucceed, withRetry,
  testSlug, createTenantUser, signInClient, deleteTestUsers, tenantClient, TEST_PASSWORD,
} from './helpers/liveFixtures.js'

const gate = await probeMigration({
  migration: '20261124120000_collect_fulfilment',
  label: 'tenants.fulfilment',
  probe: () => serviceClient().from('tenants').select('fulfilment').limit(1),
})
const SKIP = !gate.applied
describeGate('Collect fulfilment contract', gate)

const COLLECT_TENANT = 'vitest-c'
const ADDRESS = {
  street: '1 Test St', apartment: '', city: 'Soshanguve', province: 'Gauteng', postalCode: '0152',
}

describe.skipIf(SKIP)('Collect fulfilment contract', () => {
  const admin = SKIP ? null : serviceClient()
  const SLUG = testSlug('collect')
  const product = {} // tenant -> id
  const users = []

  async function newCustomer(label, tenant) {
    const user = await createTenantUser(admin, label, tenant)
    users.push(user.id)
    const client = await signInClient(user.email, TEST_PASSWORD, { tenant })
    return { user, client }
  }

  async function placeOrder({ user, client }, tenant) {
    const res = await client.rpc('place_cod_order', {
      p_customer: { name: 'Vitest Collect', email: user.email, phone: '0000000000', ...ADDRESS },
      p_items: [{ id: product[tenant], quantity: 1 }],
      p_payment_method: 'cash_on_delivery',
    })
    expect(res.error).toBeNull()
    const { data: row } = await admin.from('orders')
      .select('id, subtotal, shipping_fee, discount_cents, total, shipping_address')
      .eq('id', res.data.id).single()
    return row
  }

  beforeAll(async () => {
    mustSucceed('collect tenant', await withRetry('upsert vitest-c', () =>
      admin.from('tenants').upsert({
        slug: COLLECT_TENANT, name: 'Vitest C', order_prefix: 'VTC', min_age: 18,
        active: false, fulfilment: 'collect',
      }, { onConflict: 'slug' })))

    for (const tenant of ['224clubhouse', COLLECT_TENANT]) {
      product[tenant] = mustSucceed(`product ${tenant}`, await admin.from('products').insert({
        name: `Vitest Collect ${tenant}`, slug: `${SLUG}-${tenant}`, price: 10000,
        category: 'accessories', stock_quantity: 10, is_available: true, tenant,
      }).select('id').single()).id
    }
  })

  afterAll(async () => {
    if (!admin) return
    const ids = Object.values(product)
    await admin.from('orders').delete().in('user_id', users)
    await admin.from('drivers').delete().in('user_id', users)
    await admin.from('products').delete().in('id', ids)
    await deleteTestUsers(admin, ...users)
  })

  it('tenant_fulfilment() is collect for vitest-c and delivery with no header', async () => {
    const c = await tenantClient(COLLECT_TENANT).rpc('tenant_fulfilment')
    expect(c.error).toBeNull()
    expect(c.data).toBe('collect')
    const d = await anonClient().rpc('tenant_fulfilment')
    expect(d.data).toBe('delivery')
  })

  it('collect: order ignores the address and charges no fee', async () => {
    const row = await placeOrder(await newCustomer('collect-order', COLLECT_TENANT), COLLECT_TENANT)
    expect(row.subtotal).toBe(10000)
    expect(row.shipping_fee).toBe(0)
    expect(row.total).toBe(row.subtotal - (row.discount_cents ?? 0))
    expect(row.shipping_address).toEqual({})
  })

  it('collect: set_order_pin is refused', async () => {
    const buyer = await newCustomer('collect-pin', COLLECT_TENANT)
    const row = await placeOrder(buyer, COLLECT_TENANT)
    const { error } = await buyer.client.rpc('set_order_pin', {
      p_order_id: row.id, p_lat: -25.52, p_lng: 28.1, p_accuracy_m: 10,
    })
    expect(error?.message).toMatch(/Order not found/)
    const { data: after } = await admin.from('orders').select('pin_lat').eq('id', row.id).single()
    expect(after.pin_lat).toBeNull()
  })

  it('collect: an active driver row does not make a driver; driver RPCs refuse', async () => {
    const buyer = await newCustomer('collect-buyer', COLLECT_TENANT)
    const row = await placeOrder(buyer, COLLECT_TENANT)
    const driver = await newCustomer('collect-driver', COLLECT_TENANT)
    mustSucceed('driver row', await admin.from('drivers').insert({
      user_id: driver.user.id, full_name: 'Vitest Collect Driver', tenant: COLLECT_TENANT,
    }))
    mustSucceed('assign', await admin.from('orders').update({ driver_id: driver.user.id }).eq('id', row.id))

    const isDriver = await driver.client.rpc('is_driver')
    expect(isDriver.error).toBeNull()
    expect(isDriver.data).toBe(false)
    const start = await driver.client.rpc('driver_start_delivery', { p_order_id: row.id })
    expect(start.error?.message).toMatch(/Not authorized/)
  })

  it('delivery (224 regression): same order shape still charges 3000 and keeps the address', async () => {
    const row = await placeOrder(await newCustomer('collect-224', '224clubhouse'), '224clubhouse')
    expect(row.shipping_fee).toBe(3000)
    expect(row.total).toBe(row.subtotal - (row.discount_cents ?? 0) + 3000)
    expect(row.shipping_address.street).toBe('1 Test St')
  })
})
