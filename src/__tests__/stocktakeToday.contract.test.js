/**
 * Live-DB contract test for 20261125130000_stocktake_today.
 *
 *   Stock-take: staff on shift set a counted quantity with a reason; every
 *   change is logged (old → new, who). Customers and off-shift staff can't.
 *   Today's summary: staff-only, store-scoped, today's non-cancelled sales,
 *   online vs counter, top sellers and low stock — no customer details.
 *
 *   npm run test:local -- src/__tests__/stocktakeToday.contract.test.js
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  serviceClient, probeMigration, describeGate, mustSucceed, ensureTestTenant, TEST_TENANT,
  createTenantUser, signInClient, deleteTestUsers, TEST_PASSWORD, testSlug,
} from './helpers/liveFixtures.js'

const gate = await probeMigration({
  migration: '20261125130000_stocktake_today',
  label: 'stock_adjustments',
  probe: () => serviceClient().from('stock_adjustments').select('id').limit(1),
})
const SKIP = !gate.applied
describeGate('Stock-take and today summary contract', gate)

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9])

describe.skipIf(SKIP)('Stock-take and today summary contract', () => {
  const admin = SKIP ? null : serviceClient()
  const SLUG = testSlug('stock')
  const u = {}
  const c = {}
  const p = {}
  let variantId
  const selfies = []
  const orderIds = []

  const setStock = (client, args) => client.rpc('counter_set_stock', {
    p_product_id: p.plain, p_variant_id: null, p_counted: 7, p_reason: 'count', p_note: null, ...args,
  })
  const stockOf = async (id) => (await admin.from('products').select('stock_quantity').eq('id', id).single()).data.stock_quantity

  beforeAll(async () => {
    await ensureTestTenant(admin)
    for (const label of ['boss', 'cashier', 'idle', 'customer']) {
      u[label] = await createTenantUser(admin, `stock-${label}`, TEST_TENANT)
    }
    mustSucceed('admin', await admin.from('admin_users').insert({ id: u.boss.id, email: u.boss.email, tenant: TEST_TENANT }))
    for (const label of Object.keys(u)) c[label] = await signInClient(u[label].email, TEST_PASSWORD, { tenant: TEST_TENANT })
    for (const label of ['cashier', 'idle']) {
      mustSucceed(`staff ${label}`, await c.boss.rpc('admin_add_staff', { p_email: u[label].email, p_full_name: `Vitest ${label}` }))
    }
    const selfie = `${TEST_TENANT}/${u.cashier.id}/${Date.now()}.jpg`
    mustSucceed('selfie', await c.cashier.storage.from('shift-selfies').upload(selfie, JPEG, { contentType: 'image/jpeg' }))
    selfies.push(selfie)
    mustSucceed('shift', await c.cashier.rpc('start_shift', { p_selfie_path: selfie }))

    const product = async (key, fields) => {
      p[key] = mustSucceed(`product ${key}`, await admin.from('products').insert({
        name: `Vitest Stock ${key}`, slug: `${SLUG}-${key}`, price: 10000, category: 'accessories',
        stock_quantity: 10, is_available: true, tenant: TEST_TENANT, ...fields,
      }).select('id').single()).id
    }
    await product('plain', {})
    await product('options', {})
    variantId = mustSucceed('variant', await admin.from('product_variants').insert({
      product_id: p.options, label: '3.5g', price: 40000, stock_quantity: 4, tenant: TEST_TENANT,
    }).select('id').single()).id
    p.other = mustSucceed('224 product', await admin.from('products').insert({
      name: 'Vitest Stock 224', slug: `${SLUG}-224`, price: 10000, category: 'accessories',
      stock_quantity: 10, is_available: true, tenant: '224clubhouse',
    }).select('id').single()).id
  })

  afterAll(async () => {
    if (!admin) return
    const ids = Object.values(u).map(x => x.id)
    if (orderIds.length) await admin.from('orders').delete().in('id', orderIds)
    await admin.from('stock_adjustments').delete().in('product_id', Object.values(p))
    await admin.from('shifts').delete().in('user_id', ids)
    await admin.from('staff_members').delete().in('user_id', ids)
    await admin.from('drivers').delete().in('user_id', ids)
    await admin.from('admin_users').delete().in('id', ids)
    await admin.from('product_variants').delete().eq('product_id', p.options)
    await admin.from('products').delete().in('id', Object.values(p))
    if (selfies.length) await admin.storage.from('shift-selfies').remove(selfies)
    await deleteTestUsers(admin, ...ids)
  })

  it('customers and off-shift staff cannot change stock', async () => {
    expect((await setStock(c.customer, {})).error?.message).toMatch(/Not authorized/)
    expect((await setStock(c.idle, {})).error?.message).toMatch(/Start your shift first/)
    expect(await stockOf(p.plain)).toBe(10)
  })

  it('a count sets the stock and logs old → new, reason and who', async () => {
    const res = await setStock(c.cashier, { p_counted: 7, p_reason: 'count', p_note: 'shelf recount' })
    expect(res.error).toBeNull()
    expect(res.data).toEqual({ old_qty: 10, new_qty: 7 })
    expect(await stockOf(p.plain)).toBe(7)
    const { data: log } = await c.boss.from('stock_adjustments')
      .select('old_qty, new_qty, reason, note, user_id, product_name, variant_label').eq('product_id', p.plain)
    expect(log).toEqual([{ old_qty: 10, new_qty: 7, reason: 'count', note: 'shelf recount', user_id: u.cashier.id,
      product_name: 'Vitest Stock plain', variant_label: null }])
  })

  it('a product with options needs the option; the option count changes the option', async () => {
    const noOption = await setStock(c.cashier, { p_product_id: p.options })
    expect(noOption.error?.message).toMatch(/Choose an option for/)
    const res = await setStock(c.cashier, { p_product_id: p.options, p_variant_id: variantId, p_counted: 9, p_reason: 'received' })
    expect(res.error).toBeNull()
    const { data: v } = await admin.from('product_variants').select('stock_quantity').eq('id', variantId).single()
    expect(v.stock_quantity).toBe(9)
  })

  it('bad counts and reasons are refused; nothing changes', async () => {
    expect((await setStock(c.cashier, { p_counted: -1 })).error?.message).toMatch(/Enter a count from 0 to 100000/)
    expect((await setStock(c.cashier, { p_counted: 100001 })).error?.message).toMatch(/Enter a count from 0 to 100000/)
    expect((await setStock(c.cashier, { p_reason: 'stolen' })).error?.message).toMatch(/Invalid reason/)
    expect(await stockOf(p.plain)).toBe(7)
  })

  it("another store's product is 'Product not found'", async () => {
    expect((await setStock(c.cashier, { p_product_id: p.other })).error?.message).toMatch(/Product not found/)
  })

  it('the log is private: staff see their own rows, a customer sees none', async () => {
    const { data: own } = await c.cashier.from('stock_adjustments').select('id')
    expect(own.length).toBeGreaterThan(0)
    const { data: none } = await c.customer.from('stock_adjustments').select('id')
    expect(none ?? []).toHaveLength(0)
  })

  it("today's summary: staff only; this store's non-cancelled sales today, online vs counter", async () => {
    expect((await c.customer.rpc('store_today_summary')).error?.message).toMatch(/Not authorized/)
    const before = (await c.cashier.rpc('store_today_summary')).data

    const sale = await c.cashier.rpc('record_counter_sale', {
      p_customer: { name: 'Vitest Stock Walkin', phone: '0700000001' },
      p_items: [{ id: p.plain, quantity: 2 }], p_payment_method: 'cash_on_delivery', p_id_checked: true,
    })
    expect(sale.error).toBeNull()
    orderIds.push(sale.data.id)
    const cancelled = await c.cashier.rpc('record_counter_sale', {
      p_customer: { name: 'Vitest Stock Walkin', phone: '0700000001' },
      p_items: [{ id: p.plain, quantity: 1 }], p_payment_method: 'cash_on_delivery', p_id_checked: true,
    })
    orderIds.push(cancelled.data.id)
    await admin.from('orders').update({ status: 'cancelled' }).eq('id', cancelled.data.id)
    const other = mustSucceed('224 order', await admin.from('orders').insert({
      customer_name: 'Vitest Stock 224', customer_email: '', customer_phone: '1', items: [], subtotal: 99900,
      shipping_fee: 0, total: 99900, status: 'pending', payment_method: 'cash_on_delivery',
      shipping_address: {}, tenant: '224clubhouse',
    }).select('id').single())
    orderIds.push(other.id)

    const { data, error } = await c.cashier.rpc('store_today_summary')
    expect(error).toBeNull()
    expect(data.sales).toBe(before.sales + 1)
    expect(data.total).toBe(before.total + 20000)
    expect(data.counter).toBe(before.counter + 20000)
    expect(data.online).toBe(before.online)
    expect(data.top.some(t => t.name === 'Vitest Stock plain')).toBe(true)
    expect(JSON.stringify(data)).not.toMatch(/Walkin|0700000001/)
    // 7 - 2 - 1 = 4 left: low stock (≤ 5).
    expect(data.low_stock.some(l => l.name === 'Vitest Stock plain' && l.left === 4)).toBe(true)
  })
})
