/**
 * Live-DB contract test for migration 20261001120000_delivery_only_feedback
 * (2026-10-01 testing feedback):
 *   - membership prices: daily R10, weekly R50, monthly R150
 *   - delivery fee R30; FREE for active members (and still at R500+)
 *   - 'eft' is an accepted payment method
 *   - 'joints' is an accepted product category
 *   - after a first non-cancelled order, place_cod_order requires a membership
 *     application (pending or active) — NEGATIVE + POSITIVE controls
 *
 * Gate: the weekly tier price is the cheapest unambiguous signal the
 * migration is live (R50 = 5000, was 3000).
 *
 * Run: npx vitest run src/__tests__/deliveryFeedback.contract.test.js
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  KEYS_MISSING, anonClient, serviceClient, describeGate,
  testSlug, createTestUser, signInAs, deleteTestUsers, mustSucceed,
} from './helpers/liveFixtures.js'

const MIGRATION = '20261001120000_delivery_only_feedback'
const PRODUCT_SLUG = testSlug('feedback-product')
const PRODUCT_PRICE = 12000 // under the R500 free-delivery threshold
const DELIVERY_FEE = 3000

async function probe() {
  if (KEYS_MISSING) return { applied: false, broken: false, reason: 'need VITE_SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY' }
  const { data, error } = await anonClient().from('membership_tiers').select('price_cents').eq('slug', 'weekly').maybeSingle()
  if (error) return { applied: false, broken: true, reason: `probe failed: ${error.message}` }
  if (data?.price_cents !== 5000) return { applied: false, broken: false, reason: `migration ${MIGRATION} not applied — run \`supabase db push\`` }
  return { applied: true, broken: false, reason: '' }
}
const gate = await probe()
const SKIP = !gate.applied

const anon = SKIP ? null : anonClient()
const admin = SKIP ? null : serviceClient()
const userClient = SKIP ? null : anonClient()

let productId = null
let user = null

const orderPayload = (method = 'cash_on_delivery') => ({
  p_customer: {
    name: 'Vitest Feedback', phone: '0000000000', street: '1 Test St', apartment: '',
    city: 'Boksburg', province: 'Gauteng', postalCode: '1459',
  },
  p_items: [{ id: productId, quantity: 1 }],
  p_payment_method: method,
})

describe.skipIf(SKIP)('Delivery-only feedback contract', () => {
  beforeAll(async () => {
    const prod = mustSucceed('create joints product', await admin
      .from('products')
      .insert({
        name: `Vitest Joint ${PRODUCT_SLUG}`, slug: PRODUCT_SLUG, price: PRODUCT_PRICE,
        category: 'joints', stock_quantity: 10, is_available: true, is_member_only: false,
      })
      .select('id')
      .single())
    productId = prod.id
    user = await createTestUser(admin, 'feedback')
    await signInAs(userClient, user.email)
  })

  afterAll(async () => {
    if (!admin) return
    if (user) {
      await admin.from('orders').delete().eq('customer_email', user.email)
      await admin.from('memberships').delete().eq('email', user.email)
    }
    await admin.from('products').delete().eq('slug', PRODUCT_SLUG)
    await deleteTestUsers(admin, user?.id)
  })

  it('POSITIVE: membership tiers are R10 / R50 / R150 (public read)', async () => {
    const { data, error } = await anon.from('membership_tiers').select('slug, price_cents')
    expect(error).toBeNull()
    const price = Object.fromEntries(data.map(t => [t.slug, t.price_cents]))
    expect(price.daily).toBe(1000)
    expect(price.weekly).toBe(5000)
    expect(price.monthly).toBe(15000)
  })

  it('POSITIVE: first order by EFT is accepted, with R30 delivery for a non-member', async () => {
    const { data, error } = await userClient.rpc('place_cod_order', orderPayload('eft'))
    expect(error).toBeNull()
    expect(data.shipping_fee).toBe(DELIVERY_FEE)
    expect(data.total).toBe(PRODUCT_PRICE + DELIVERY_FEE)
  })

  it('NEGATIVE: a second order without a membership application is rejected — no order created', async () => {
    const { data, error } = await userClient.rpc('place_cod_order', orderPayload())
    expect(data).toBeNull()
    expect(error?.message).toMatch(/^Membership required:/)
    const { count } = await admin.from('orders').select('id', { count: 'exact', head: true }).eq('customer_email', user.email)
    expect(count).toBe(1)
  })

  it('POSITIVE: with a PENDING application the second order goes through (delivery still charged)', async () => {
    mustSucceed('pending membership', await admin.from('memberships').insert({
      user_id: user.id, full_name: 'Vitest Feedback', email: user.email, phone: '0000000000',
      date_of_birth: '1990-01-01', tier: 'daily', amount: 1000, status: 'pending', starts_at: null,
    }))
    const { data, error } = await userClient.rpc('place_cod_order', orderPayload())
    expect(error).toBeNull()
    expect(data.shipping_fee).toBe(DELIVERY_FEE)
  })

  it('POSITIVE: an ACTIVE member gets free delivery', async () => {
    mustSucceed('activate membership', await admin.from('memberships')
      .update({ status: 'active', starts_at: new Date().toISOString(), expires_at: new Date(Date.now() + 86400000).toISOString() })
      .eq('email', user.email))
    const { data, error } = await userClient.rpc('place_cod_order', orderPayload('card_on_delivery'))
    expect(error).toBeNull()
    expect(data.shipping_fee).toBe(0)
    expect(data.total).toBe(PRODUCT_PRICE)
  })

  it('NEGATIVE: an unknown payment method is still rejected', async () => {
    const { data, error } = await userClient.rpc('place_cod_order', orderPayload('bitcoin'))
    expect(data).toBeNull()
    expect(error?.message).toMatch(/Invalid payment method/)
  })
})

describeGate('Delivery-only feedback contract', gate)
