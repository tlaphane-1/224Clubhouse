/**
 * Live-DB contract test for 20261125140000_table_menu.
 *
 *   Membership card: each account gets an unguessable token (QR on their
 *   phone); "New code" replaces it.
 *   Table mode (tablet signed in as staff): identify by card, see own orders
 *   (no phone/email), send an order to the counter, rate products received.
 *   Counter: list recent table orders, close them.
 *   Customers can't call staff RPCs; forged/rotated/other-store cards are
 *   "Card not recognised"; stale table orders are not listed.
 *
 *   npm run test:local -- src/__tests__/tableMenu.contract.test.js
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  serviceClient, probeMigration, describeGate, mustSucceed, ensureTestTenant, TEST_TENANT,
  createTenantUser, signInClient, deleteTestUsers, TEST_PASSWORD, testSlug,
} from './helpers/liveFixtures.js'

const gate = await probeMigration({
  migration: '20261125140000_table_menu',
  label: 'member_cards',
  probe: () => serviceClient().from('member_cards').select('user_id').limit(1),
})
const SKIP = !gate.applied
describeGate('Table menu contract', gate)

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9])
const FORGED = '00000000-0000-4000-8000-000000000000'

describe.skipIf(SKIP)('Table menu contract', () => {
  const admin = SKIP ? null : serviceClient()
  const SLUG = testSlug('table')
  const u = {}
  const c = {}
  const p = {}
  const selfies = []
  let token

  beforeAll(async () => {
    await ensureTestTenant(admin)
    for (const label of ['boss', 'cashier', 'guest']) {
      u[label] = await createTenantUser(admin, `table-${label}`, TEST_TENANT)
    }
    u.other = await createTenantUser(admin, 'table-224', '224clubhouse')
    mustSucceed('admin', await admin.from('admin_users').insert({ id: u.boss.id, email: u.boss.email, tenant: TEST_TENANT }))
    for (const label of ['boss', 'cashier', 'guest']) c[label] = await signInClient(u[label].email, TEST_PASSWORD, { tenant: TEST_TENANT })
    c.other = await signInClient(u.other.email, TEST_PASSWORD)
    mustSucceed('staff', await c.boss.rpc('admin_add_staff', { p_email: u.cashier.email, p_full_name: 'Vitest Cashier' }))
    const selfie = `${TEST_TENANT}/${u.cashier.id}/${Date.now()}.jpg`
    mustSucceed('selfie', await c.cashier.storage.from('shift-selfies').upload(selfie, JPEG, { contentType: 'image/jpeg' }))
    selfies.push(selfie)
    mustSucceed('shift', await c.cashier.rpc('start_shift', { p_selfie_path: selfie }))

    for (const key of ['bought', 'never']) {
      p[key] = mustSucceed(`product ${key}`, await admin.from('products').insert({
        name: `Vitest Table ${key}`, slug: `${SLUG}-${key}`, price: 12000, category: 'accessories',
        stock_quantity: 10, is_available: true, tenant: TEST_TENANT,
      }).select('id').single()).id
    }
    // The guest bought one at the counter earlier (collected).
    mustSucceed('earlier sale', await c.cashier.rpc('record_counter_sale', {
      p_customer: { user_id: u.guest.id, name: 'Thabo Vitest', phone: '0712223333' },
      p_items: [{ id: p.bought, quantity: 1 }], p_payment_method: 'cash_on_delivery', p_id_checked: true,
    }))
  })

  afterAll(async () => {
    if (!admin) return
    const ids = Object.values(u).map(x => x.id)
    await admin.from('table_requests').delete().in('user_id', ids)
    await admin.from('product_reviews').delete().in('user_id', ids)
    await admin.from('orders').delete().in('user_id', ids)
    await admin.from('member_cards').delete().in('user_id', ids)
    await admin.from('shifts').delete().in('user_id', ids)
    await admin.from('staff_members').delete().in('user_id', ids)
    await admin.from('drivers').delete().in('user_id', ids)
    await admin.from('admin_users').delete().in('id', ids)
    await admin.from('products').delete().in('id', Object.values(p))
    if (selfies.length) await admin.storage.from('shift-selfies').remove(selfies)
    await deleteTestUsers(admin, ...ids)
  })

  it('a customer gets one card token; asking again returns the same one', async () => {
    const first = await c.guest.rpc('my_member_card')
    expect(first.error).toBeNull()
    expect(first.data).toMatch(/^[0-9a-f-]{36}$/)
    const again = await c.guest.rpc('my_member_card')
    expect(again.data).toBe(first.data)
    token = first.data
  })

  it('a customer cannot use the staff table/counter functions', async () => {
    expect((await c.guest.rpc('table_identify', { p_token: token })).error?.message).toMatch(/Not authorized/)
    expect((await c.guest.rpc('card_customer', { p_token: token })).error?.message).toMatch(/Not authorized/)
    expect((await c.guest.rpc('counter_table_requests')).error?.message).toMatch(/Not authorized/)
  })

  it('table_identify: first name, membership, own orders and reviewable products — no phone or email', async () => {
    const { data, error } = await c.cashier.rpc('table_identify', { p_token: token })
    expect(error).toBeNull()
    expect(data.first_name).toBe('Thabo')
    expect(data.member_status).toBe('none')
    expect(data.orders).toHaveLength(1)
    expect(data.reviewable.map(r => r.product_id)).toEqual([p.bought])
    expect(JSON.stringify(data)).not.toMatch(/0712223333|@example\.com/)
  })

  it('card_customer (counter, on shift) returns the account for a sale', async () => {
    const { data, error } = await c.cashier.rpc('card_customer', { p_token: token })
    expect(error).toBeNull()
    expect(data[0]).toMatchObject({ user_id: u.guest.id, phone: '0712223333', member_status: 'none' })
  })

  it('a forged card or another store’s card is not recognised', async () => {
    expect((await c.cashier.rpc('table_identify', { p_token: FORGED })).error?.message).toMatch(/Card not recognised/)
    const otherCard = (await c.other.rpc('my_member_card')).data
    expect((await c.cashier.rpc('table_identify', { p_token: otherCard })).error?.message).toMatch(/Card not recognised/)
  })

  it('a table order reaches the counter with current product details, then closes', async () => {
    const sent = await c.cashier.rpc('table_submit_request', { p_token: token, p_items: [{ id: p.bought, quantity: 2 }] })
    expect(sent.error).toBeNull()
    const list = await c.cashier.rpc('counter_table_requests')
    expect(list.error).toBeNull()
    const mine = list.data.find(r => r.id === sent.data)
    expect(mine).toMatchObject({ user_id: u.guest.id, full_name: 'Thabo Vitest' })
    expect(mine.items[0]).toMatchObject({ id: p.bought, quantity: 2, name: 'Vitest Table bought', price: 12000, stock: 9 })
    mustSucceed('close', await c.cashier.rpc('counter_close_table_request', { p_id: sent.data, p_status: 'done' }))
    const after = await c.cashier.rpc('counter_table_requests')
    expect(after.data.some(r => r.id === sent.data)).toBe(false)
  })

  it('a table order for another store’s or unknown product is refused', async () => {
    const r = await c.cashier.rpc('table_submit_request', { p_token: token, p_items: [{ id: FORGED, quantity: 1 }] })
    expect(r.error?.message).toMatch(/Product not found/)
  })

  it('table orders older than 30 minutes are not shown to the counter', async () => {
    const sent = await c.cashier.rpc('table_submit_request', { p_token: token, p_items: [{ id: p.bought, quantity: 1 }] })
    await admin.from('table_requests').update({ created_at: new Date(Date.now() - 31 * 60000).toISOString() }).eq('id', sent.data)
    const list = await c.cashier.rpc('counter_table_requests')
    expect(list.data.some(r => r.id === sent.data)).toBe(false)
  })

  it('ratings: a product they received is saved for moderation; one they never had is refused', async () => {
    const ok = await c.cashier.rpc('table_submit_review', { p_token: token, p_product_id: p.bought, p_rating: 5, p_body: 'Lovely' })
    expect(ok.error).toBeNull()
    const { data: row } = await admin.from('product_reviews').select('status, display_name, rating').eq('user_id', u.guest.id).single()
    expect(row).toEqual({ status: 'pending', display_name: 'Thabo', rating: 5 })
    const no = await c.cashier.rpc('table_submit_review', { p_token: token, p_product_id: p.never, p_rating: 4, p_body: '' })
    expect(no.error?.message).toMatch(/Only customers who have received this product/)
  })

  it('"New code" replaces the card: the old one stops working', async () => {
    const fresh = await c.guest.rpc('rotate_member_card')
    expect(fresh.error).toBeNull()
    expect(fresh.data).not.toBe(token)
    expect((await c.cashier.rpc('table_identify', { p_token: token })).error?.message).toMatch(/Card not recognised/)
    expect((await c.cashier.rpc('table_identify', { p_token: fresh.data })).error).toBeNull()
  })
})
