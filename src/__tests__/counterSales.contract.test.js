/**
 * Live-DB contract test for 20261125120000_counter_sales.
 *
 * Staff on shift ring up in-store sales at the counter tablet:
 *   POSITIVE — a sale re-prices from the DB, drops stock (variant or product)
 *              and is stored as a collected, paid counter order.
 *   NEGATIVE — customers can't sell, search or read history; staff need an
 *              open shift and must confirm the ID check; member-only, stock
 *              and other stores' products are refused.
 *   Customer search and the last-10-orders history are staff-only and
 *   store-scoped.
 *
 *   npm run test:local -- src/__tests__/counterSales.contract.test.js
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  serviceClient, probeMigration, describeGate, mustSucceed, ensureTestTenant, TEST_TENANT,
  createTenantUser, signInClient, deleteTestUsers, TEST_PASSWORD, testSlug,
} from './helpers/liveFixtures.js'

const gate = await probeMigration({
  migration: '20261125120000_counter_sales',
  label: 'orders.channel',
  probe: () => serviceClient().from('orders').select('channel').limit(1),
})
const SKIP = !gate.applied
describeGate('Counter sales contract', gate)

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9])
const MEMBER_PHONE = '0711112222'
const WALKIN_PHONE = '0723334444'

describe.skipIf(SKIP)('Counter sales contract', () => {
  const admin = SKIP ? null : serviceClient()
  const SLUG = testSlug('counter')
  const u = {}
  const c = {}
  const p = {} // product ids
  let variantId
  const selfies = []

  const sale = (client, customer, items, extra = {}) => client.rpc('record_counter_sale', {
    p_customer: customer,
    p_items: items,
    p_payment_method: 'cash_on_delivery',
    p_id_checked: true,
    ...extra,
  })
  const stockOf = async (id) => (await admin.from('products').select('stock_quantity').eq('id', id).single()).data.stock_quantity

  beforeAll(async () => {
    await ensureTestTenant(admin)
    for (const label of ['boss', 'cashier', 'idle', 'member']) {
      u[label] = await createTenantUser(admin, `counter-${label}`, TEST_TENANT)
    }
    mustSucceed('admin', await admin.from('admin_users').insert({ id: u.boss.id, email: u.boss.email, tenant: TEST_TENANT }))
    for (const label of Object.keys(u)) c[label] = await signInClient(u[label].email, TEST_PASSWORD, { tenant: TEST_TENANT })

    for (const label of ['cashier', 'idle']) {
      mustSucceed(`staff ${label}`, await c.boss.rpc('admin_add_staff', { p_email: u[label].email, p_full_name: `Vitest ${label}` }))
    }
    // The cashier is on shift; "idle" is staff but not on shift.
    const selfie = `${TEST_TENANT}/${u.cashier.id}/${Date.now()}.jpg`
    mustSucceed('selfie', await c.cashier.storage.from('shift-selfies').upload(selfie, JPEG, { contentType: 'image/jpeg' }))
    selfies.push(selfie)
    mustSucceed('shift', await c.cashier.rpc('start_shift', { p_selfie_path: selfie }))

    mustSucceed('membership', await admin.from('memberships').insert({
      user_id: u.member.id, full_name: 'Vitest Counter Member', email: u.member.email, phone: MEMBER_PHONE,
      date_of_birth: '1990-01-01', tier: 'gold', amount: 1000, status: 'active',
      starts_at: new Date(Date.now() - 86400000).toISOString(),
      expires_at: new Date(Date.now() + 30 * 86400000).toISOString(), tenant: TEST_TENANT,
    }))

    const product = async (key, fields) => {
      p[key] = mustSucceed(`product ${key}`, await admin.from('products').insert({
        name: `Vitest Counter ${key}`, slug: `${SLUG}-${key}`, price: 15000, category: 'accessories',
        stock_quantity: 5, is_available: true, tenant: TEST_TENANT, ...fields,
      }).select('id').single()).id
    }
    await product('plain', {})
    await product('members', { is_member_only: true })
    await product('last', { stock_quantity: 1 })
    await product('options', {})
    variantId = mustSucceed('variant', await admin.from('product_variants').insert({
      product_id: p.options, label: '3.5g', price: 40000, stock_quantity: 4, tenant: TEST_TENANT,
    }).select('id').single()).id
    p.other = mustSucceed('224 product', await admin.from('products').insert({
      name: 'Vitest Counter 224', slug: `${SLUG}-224`, price: 15000, category: 'accessories',
      stock_quantity: 5, is_available: true, tenant: '224clubhouse',
    }).select('id').single()).id
  })

  afterAll(async () => {
    if (!admin) return
    const ids = Object.values(u).map(x => x.id)
    await admin.from('orders').delete().eq('tenant', TEST_TENANT).like('customer_name', 'Vitest Counter%')
    await admin.from('orders').delete().in('user_id', ids)
    await admin.from('shifts').delete().in('user_id', ids)
    await admin.from('staff_members').delete().in('user_id', ids)
    await admin.from('memberships').delete().in('user_id', ids)
    await admin.from('drivers').delete().in('user_id', ids)
    await admin.from('admin_users').delete().in('id', ids)
    await admin.from('product_variants').delete().eq('product_id', p.options)
    await admin.from('products').delete().in('id', Object.values(p))
    if (selfies.length) await admin.storage.from('shift-selfies').remove(selfies)
    await deleteTestUsers(admin, ...ids)
  })

  it('a customer cannot record a sale, search customers or read history', async () => {
    const s = await sale(c.member, { name: 'x', phone: '1' }, [{ id: p.plain, quantity: 1 }])
    expect(s.error?.message).toMatch(/Not authorized/)
    const f = await c.member.rpc('counter_find_customers', { p_query: 'Vitest' })
    expect(f.error?.message).toMatch(/Not authorized/)
    const h = await c.member.rpc('counter_customer_history', { p_user_id: u.member.id, p_phone: null })
    expect(h.error?.message).toMatch(/Not authorized/)
  })

  it('staff without an open shift cannot record a sale', async () => {
    const s = await sale(c.idle, { name: 'Vitest Counter Walkin', phone: WALKIN_PHONE }, [{ id: p.plain, quantity: 1 }])
    expect(s.error?.message).toMatch(/Start your shift first/)
  })

  it('the ID check must be confirmed', async () => {
    const s = await sale(c.cashier, { name: 'Vitest Counter Walkin', phone: WALKIN_PHONE },
      [{ id: p.plain, quantity: 1 }], { p_id_checked: false })
    expect(s.error?.message).toMatch(/Confirm you checked their ID/)
  })

  it('a sale for an account: DB prices, stock drops, stored as a collected paid counter order', async () => {
    const before = await stockOf(p.plain)
    const s = await sale(c.cashier, { user_id: u.member.id, name: 'Vitest Counter Member', phone: MEMBER_PHONE },
      [{ id: p.plain, quantity: 2, price: 1 }])
    expect(s.error).toBeNull()
    expect(s.data.total).toBe(30000)
    expect(await stockOf(p.plain)).toBe(before - 2)
    const { data: row } = await admin.from('orders')
      .select('channel, status, paid_at, paid_amount_cents, served_by, user_id, customer_email, shipping_fee, shipping_address, tenant')
      .eq('id', s.data.id).single()
    expect(row).toMatchObject({
      channel: 'counter', status: 'delivered', paid_amount_cents: 30000, served_by: u.cashier.id,
      user_id: u.member.id, customer_email: u.member.email, shipping_fee: 0, shipping_address: {}, tenant: TEST_TENANT,
    })
    expect(row.paid_at).toBeTruthy()
  })

  it('a variant line decrements the variant and is priced from it', async () => {
    const s = await sale(c.cashier, { name: 'Vitest Counter Walkin', phone: WALKIN_PHONE },
      [{ id: p.options, variant_id: variantId, quantity: 1 }])
    expect(s.error).toBeNull()
    expect(s.data.total).toBe(40000)
    const { data: v } = await admin.from('product_variants').select('stock_quantity').eq('id', variantId).single()
    expect(v.stock_quantity).toBe(3)
  })

  it('a walk-in has no account and no email; history by phone finds the sale', async () => {
    const s = await sale(c.cashier, { name: 'Vitest Counter Walkin', phone: WALKIN_PHONE },
      [{ id: p.plain, quantity: 1 }])
    expect(s.error).toBeNull()
    const { data: row } = await admin.from('orders').select('user_id, customer_email').eq('id', s.data.id).single()
    expect(row).toEqual({ user_id: null, customer_email: '' })
    const h = await c.cashier.rpc('counter_customer_history', { p_user_id: null, p_phone: WALKIN_PHONE })
    expect(h.error).toBeNull()
    expect(h.data.map(r => r.order_number)).toContain(s.data.order_number)
  })

  it('a user_id from another store is ignored (sale saved as a walk-in)', async () => {
    const other = await createTenantUser(admin, 'counter-224', '224clubhouse')
    u.other224 = other
    const s = await sale(c.cashier, { user_id: other.id, name: 'Vitest Counter Stranger', phone: '0700000000' },
      [{ id: p.plain, quantity: 1 }])
    expect(s.error).toBeNull()
    const { data: row } = await admin.from('orders').select('user_id').eq('id', s.data.id).single()
    expect(row.user_id).toBeNull()
  })

  it('member-only products: refused for a walk-in, sold to the member', async () => {
    const walkin = await sale(c.cashier, { name: 'Vitest Counter Walkin', phone: WALKIN_PHONE }, [{ id: p.members, quantity: 1 }])
    expect(walkin.error?.message).toMatch(/is for members only/)
    const member = await sale(c.cashier, { user_id: u.member.id, name: 'Vitest Counter Member', phone: MEMBER_PHONE },
      [{ id: p.members, quantity: 1 }])
    expect(member.error).toBeNull()
  })

  it('insufficient stock refuses the whole sale and changes nothing', async () => {
    const plainBefore = await stockOf(p.plain)
    const s = await sale(c.cashier, { name: 'Vitest Counter Walkin', phone: WALKIN_PHONE },
      [{ id: p.plain, quantity: 1 }, { id: p.last, quantity: 2 }])
    expect(s.error?.message).toMatch(/Insufficient stock/)
    expect(await stockOf(p.plain)).toBe(plainBefore)
    expect(await stockOf(p.last)).toBe(1)
  })

  it("another store's product is 'Product not found'", async () => {
    const s = await sale(c.cashier, { name: 'Vitest Counter Walkin', phone: WALKIN_PHONE }, [{ id: p.other, quantity: 1 }])
    expect(s.error?.message).toMatch(/Product not found/)
  })

  it('counter_find_customers finds the member by name and by phone; a 1-letter query finds nothing', async () => {
    const byName = await c.cashier.rpc('counter_find_customers', { p_query: 'counter memb' })
    expect(byName.error).toBeNull()
    const hit = byName.data.find(r => r.user_id === u.member.id)
    expect(hit).toMatchObject({ member_status: 'active', phone: MEMBER_PHONE })
    const byPhone = await c.cashier.rpc('counter_find_customers', { p_query: '1111222' })
    expect(byPhone.data.some(r => r.user_id === u.member.id)).toBe(true)
    const short = await c.cashier.rpc('counter_find_customers', { p_query: 'Vi' })
    expect(short.data).toEqual([])
  })

  it('search results carry no email address (data minimisation)', async () => {
    const { data } = await c.cashier.rpc('counter_find_customers', { p_query: 'counter memb' })
    expect(data.length).toBeGreaterThan(0)
    for (const row of data) expect(row).not.toHaveProperty('email')
  })

  it('staff who are not on shift cannot search customers or read history', async () => {
    const f = await c.idle.rpc('counter_find_customers', { p_query: 'counter memb' })
    expect(f.error?.message).toMatch(/Start your shift first/)
    const h = await c.idle.rpc('counter_customer_history', { p_user_id: u.member.id, p_phone: null })
    expect(h.error?.message).toMatch(/Start your shift first/)
  })

  it('history: newest first, at most 10, no cancelled orders', async () => {
    await admin.from('products').update({ stock_quantity: 50 }).eq('id', p.plain)
    for (let i = 0; i < 10; i++) {
      mustSucceed(`sale ${i}`, await sale(c.cashier,
        { user_id: u.member.id, name: 'Vitest Counter Member', phone: MEMBER_PHONE },
        [{ id: p.plain, quantity: 1 }]))
    }
    const { data: newest } = await admin.from('orders').select('id, order_number').eq('user_id', u.member.id)
      .order('created_at', { ascending: false }).limit(1).single()
    await admin.from('orders').update({ status: 'cancelled' }).eq('id', newest.id)
    const h = await c.cashier.rpc('counter_customer_history', { p_user_id: u.member.id, p_phone: null })
    expect(h.error).toBeNull()
    expect(h.data).toHaveLength(10)
    expect(h.data.map(r => r.order_number)).not.toContain(newest.order_number)
    const times = h.data.map(r => Date.parse(r.created_at))
    expect([...times].sort((a, b) => b - a)).toEqual(times)
  })
})
