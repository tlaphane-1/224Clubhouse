/**
 * Live-DB contract test for the 2026-10-05 store upgrades (Layer 1 + 2):
 *
 *   20261005140000_product_variants
 *     POSITIVE — options keep products.price/stock_quantity in step (trigger).
 *     POSITIVE — an order line with variant_id is priced and decremented from
 *                the option, and stores variant_label.
 *     NEGATIVE — a plain line for a product with options is rejected.
 *     POSITIVE — cancelling restocks the option, not the product.
 *     NEGATIVE — anon cannot write options.
 *
 *   20261005150000_abandoned_cart_reminders
 *     POSITIVE — a customer can save and read their own cart.
 *     NEGATIVE — another customer and anon cannot read it.
 *     NEGATIVE — a client cannot set reminded_at (it would silence or re-arm
 *                reminders) and cannot call the service-only claim function.
 *     NEGATIVE — a made-up opt-out token changes nothing.
 *
 *   20261005160000_product_reviews
 *     NEGATIVE — a customer without a DELIVERED order cannot review.
 *     POSITIVE — after delivery they can; the review stays hidden until an
 *                admin approves it; the public RPC exposes display fields only.
 *     NEGATIVE — anon cannot read the table directly (negative control for
 *                the RPC: if this ever returns rows, user ids are leaking).
 *
 * Gated per migration on its marker RPC / table, so the file is green-skip
 * until `supabase db push`, and LOUD if a probe breaks (see probeMigration).
 *
 * How to run (PowerShell):
 *   npx vitest run src/__tests__/storeUpgrades.contract.test.js
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  anonClient, serviceClient, probeMigration, describeGate,
  testSlug, createTestUser, signInAs, deleteTestUsers, mustSucceed,
  grantPendingMembership,
} from './helpers/liveFixtures.js'

const variantsGate = await probeMigration({
  migration: '20261005140000_product_variants',
  label: 'product_variants_applied()',
  probe: () => anonClient().rpc('product_variants_applied'),
})
const cartsGate = await probeMigration({
  migration: '20261005150000_abandoned_cart_reminders',
  label: 'cart_reminders_applied()',
  probe: () => anonClient().rpc('cart_reminders_applied'),
})
const reviewsGate = await probeMigration({
  migration: '20261005160000_product_reviews',
  label: 'get_product_reviews()',
  probe: () => anonClient().rpc('get_product_reviews', { p_product_id: randomUUID() }),
})

const ALL = variantsGate.applied && cartsGate.applied && reviewsGate.applied
const admin = ALL ? serviceClient() : null
const buyer = ALL ? anonClient() : null
const other = ALL ? anonClient() : null
const adminClient = ALL ? anonClient() : null
const anon = ALL ? anonClient() : null

const SLUG = testSlug('options-product')
let productId, smallId, largeId
let buyerUser, otherUser, adminUser
let orderId

const customer = (email) => ({
  name: 'Vitest Upgrades', email, phone: '0000000000', street: '1 Test St',
  apartment: '', city: 'Boksburg', province: 'Gauteng', postalCode: '1459',
})

async function product() {
  return mustSucceed('read product', await admin
    .from('products').select('price, stock_quantity').eq('id', productId).single())
}
async function variant(id) {
  return mustSucceed('read variant', await admin
    .from('product_variants').select('stock_quantity').eq('id', id).single())
}

describe.skipIf(!ALL)('Store upgrades contract', () => {
  beforeAll(async () => {
    productId = mustSucceed('create product', await admin.from('products').insert({
      name: `Vitest Options ${SLUG}`, slug: SLUG, price: 99999, category: 'flower',
      stock_quantity: 0, is_available: true,
    }).select('id').single()).id
    const rows = mustSucceed('create options', await admin.from('product_variants').insert([
      { product_id: productId, label: '1g', price: 12000, stock_quantity: 5, sort_order: 0 },
      { product_id: productId, label: '7g', price: 60000, stock_quantity: 3, sort_order: 1 },
    ]).select('id, label'))
    smallId = rows.find(r => r.label === '1g').id
    largeId = rows.find(r => r.label === '7g').id

    buyerUser = await createTestUser(admin, 'upgrades-buyer')
    otherUser = await createTestUser(admin, 'upgrades-other')
    adminUser = await createTestUser(admin, 'upgrades-admin')
    await grantPendingMembership(admin, buyerUser) // the buyer places two orders
    mustSucceed('grant admin', await admin.from('admin_users')
      .insert({ id: adminUser.id, email: adminUser.email }))
    await signInAs(buyer, buyerUser.email)
    await signInAs(other, otherUser.email)
    await signInAs(adminClient, adminUser.email)
  })

  afterAll(async () => {
    if (!admin) return
    const emails = [buyerUser?.email, otherUser?.email, adminUser?.email].filter(Boolean)
    if (emails.length) await admin.from('orders').delete().in('customer_email', emails)
    if (emails.length) await admin.from('memberships').delete().in('email', emails)
    // Cascades to product_variants and product_reviews.
    await admin.from('products').delete().eq('slug', SLUG)
    // Cascades to saved_carts, customer_email_prefs, admin_users.
    await deleteTestUsers(admin, buyerUser?.id, otherUser?.id, adminUser?.id)
  })

  // ---- Variants -----------------------------------------------------------

  it('trigger: product price = cheapest option, stock = total', async () => {
    expect(await product()).toEqual({ price: 12000, stock_quantity: 8 })
  })

  it('NEGATIVE: anon cannot add an option', async () => {
    const { error } = await anon.from('product_variants')
      .insert({ product_id: productId, label: 'hack', price: 1, stock_quantity: 99 })
    expect(error).not.toBeNull()
  })

  it('NEGATIVE: a plain line for a product with options is rejected', async () => {
    const { error } = await buyer.rpc('place_cod_order', {
      p_customer: customer(buyerUser.email),
      p_items: [{ id: productId, quantity: 1 }],
      p_payment_method: 'cash_on_delivery',
    })
    expect(error?.message).toMatch(/choose an option/i)
  })

  it('POSITIVE: an option line is priced and decremented from the option', async () => {
    const { data, error } = await buyer.rpc('place_cod_order', {
      p_customer: customer(buyerUser.email),
      p_items: [{ id: productId, variant_id: largeId, quantity: 2 }],
      p_payment_method: 'cash_on_delivery',
    })
    expect(error).toBeNull()
    expect(data.subtotal).toBe(120000)
    const row = mustSucceed('read order', await admin.from('orders')
      .select('id, items').eq('order_number', data.order_number).single())
    orderId = row.id
    expect(row.items[0]).toMatchObject({ variant_id: largeId, variant_label: '7g', price: 60000, quantity: 2 })
    expect((await variant(largeId)).stock_quantity).toBe(1)
    expect((await variant(smallId)).stock_quantity).toBe(5)
    expect((await product()).stock_quantity).toBe(6)
  })

  it('POSITIVE: cancelling restocks the option that was sold', async () => {
    const { data, error } = await adminClient.rpc('admin_update_order_status', {
      p_order_id: orderId, p_status: 'cancelled',
    })
    expect(error).toBeNull()
    expect(data.restocked_units).toBe(2)
    expect((await variant(largeId)).stock_quantity).toBe(3)
    expect((await product()).stock_quantity).toBe(8)
  })

  // ---- Saved carts --------------------------------------------------------

  it('POSITIVE: a customer saves and reads their own cart', async () => {
    const items = [{ id: productId, variant_id: smallId, variant_label: '1g', name: 'x', price: 12000, quantity: 1 }]
    mustSucceed('save cart', await buyer.from('saved_carts')
      .upsert({ user_id: buyerUser.id, items }, { onConflict: 'user_id' }))
    const { data, error } = await buyer.from('saved_carts').select('items').eq('user_id', buyerUser.id).single()
    expect(error).toBeNull()
    expect(data.items).toHaveLength(1)
  })

  it('NEGATIVE: another customer and anon cannot read it', async () => {
    const { data: o } = await other.from('saved_carts').select('*').eq('user_id', buyerUser.id)
    expect(o).toEqual([])
    const { data: a } = await anon.from('saved_carts').select('*')
    expect(a).toEqual([])
  })

  it('NEGATIVE: a client cannot set reminded_at', async () => {
    await buyer.from('saved_carts').update({ reminded_at: new Date().toISOString() }).eq('user_id', buyerUser.id)
    const row = mustSucceed('read cart', await admin.from('saved_carts')
      .select('reminded_at').eq('user_id', buyerUser.id).single())
    expect(row.reminded_at).toBeNull()
  })

  it('NEGATIVE: a client cannot claim reminders (it returns emails)', async () => {
    const { error } = await buyer.rpc('claim_cart_reminders', { p_limit: 5 })
    expect(error).not.toBeNull()
  })

  it('NEGATIVE: a made-up opt-out token changes nothing', async () => {
    const { data, error } = await anon.rpc('stop_cart_reminders', { p_token: randomUUID() })
    expect(error).toBeNull()
    expect(data).toBe(false)
  })

  // ---- Reviews ------------------------------------------------------------

  it('NEGATIVE: no delivered order, no review', async () => {
    const { error } = await other.rpc('submit_product_review', {
      p_product_id: productId, p_rating: 5, p_body: 'great', p_display_name: 'Other',
    })
    expect(error?.message).toMatch(/received this product/i)
  })

  it('POSITIVE: after delivery the buyer can review; hidden until approved', async () => {
    const { data: placed, error: e1 } = await buyer.rpc('place_cod_order', {
      p_customer: customer(buyerUser.email),
      p_items: [{ id: productId, variant_id: smallId, quantity: 1 }],
      p_payment_method: 'cash_on_delivery',
    })
    expect(e1).toBeNull()
    const order = mustSucceed('read order', await admin.from('orders')
      .select('id').eq('order_number', placed.order_number).single())
    const { error: e2 } = await adminClient.rpc('admin_update_order_status', {
      p_order_id: order.id, p_status: 'delivered',
    })
    expect(e2).toBeNull()

    const status = await buyer.rpc('my_review_status', { p_product_id: productId })
    expect(status.data?.eligible).toBe(true)

    const { error: e3 } = await buyer.rpc('submit_product_review', {
      p_product_id: productId, p_rating: 4, p_body: 'Smooth', p_display_name: 'Vitest B.',
    })
    expect(e3).toBeNull()

    const pub = await anon.rpc('get_product_reviews', { p_product_id: productId })
    expect(pub.error).toBeNull()
    expect(pub.data.count).toBe(0)
  })

  it('POSITIVE: once approved, the public sees display fields only', async () => {
    const review = mustSucceed('find review', await adminClient.from('product_reviews')
      .select('id').eq('product_id', productId).single())
    mustSucceed('approve', await adminClient.from('product_reviews')
      .update({ status: 'approved' }).eq('id', review.id))

    const pub = await anon.rpc('get_product_reviews', { p_product_id: productId })
    expect(pub.data.count).toBe(1)
    expect(Number(pub.data.average)).toBe(4)
    expect(Object.keys(pub.data.reviews[0]).sort()).toEqual(['body', 'created_at', 'display_name', 'rating'])
  })

  it('NEGATIVE: anon reads nothing from the reviews table directly', async () => {
    const { data } = await anon.from('product_reviews').select('*').eq('product_id', productId)
    expect(data).toEqual([])
  })
})

describeGate('Store upgrades contract (variants)', variantsGate)
describeGate('Store upgrades contract (saved carts)', cartsGate)
describeGate('Store upgrades contract (reviews)', reviewsGate)
