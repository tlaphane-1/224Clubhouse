/**
 * Live-DB contract test for 20261008120000_age_verification.
 *
 *   NEGATIVE — an account with no date of birth on record cannot order.
 *   NEGATIVE — an under-21 date of birth is rejected.
 *   POSITIVE — a 21+ date of birth is accepted; the account can then order.
 *   NEGATIVE — the date of birth can't be changed once on record.
 *   NEGATIVE — anon and other customers can't read someone's profile.
 *
 *   npx vitest run src/__tests__/ageVerification.contract.test.js
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  anonClient, serviceClient, probeMigration, describeGate,
  testSlug, createTestUser, signInAs, deleteTestUsers, mustSucceed,
} from './helpers/liveFixtures.js'

const gate = await probeMigration({
  migration: '20261008120000_age_verification',
  label: 'age_verification_applied()',
  probe: () => anonClient().rpc('age_verification_applied'),
})
const SKIP = !gate.applied

const admin = SKIP ? null : serviceClient()
const buyer = SKIP ? null : anonClient()
const other = SKIP ? null : anonClient()
const anon = SKIP ? null : anonClient()

const SLUG = testSlug('age-product')
let productId, buyerUser, otherUser

const yearsAgo = (n) => {
  const d = new Date()
  d.setFullYear(d.getFullYear() - n)
  return d.toISOString().slice(0, 10)
}

const order = () => buyer.rpc('place_cod_order', {
  p_customer: {
    name: 'Vitest Age', email: buyerUser.email, phone: '0000000000', street: '1 Test St',
    apartment: '', city: 'Boksburg', province: 'Gauteng', postalCode: '1459',
  },
  p_items: [{ id: productId, quantity: 1 }],
  p_payment_method: 'cash_on_delivery',
})

describe.skipIf(SKIP)('Age verification contract', () => {
  beforeAll(async () => {
    productId = mustSucceed('product', await admin.from('products').insert({
      name: `Vitest Age ${SLUG}`, slug: SLUG, price: 1000, category: 'accessories', stock_quantity: 5, is_available: true,
    }).select('id').single()).id
    buyerUser = await createTestUser(admin, 'age-buyer')
    otherUser = await createTestUser(admin, 'age-other')
    // createTestUser gives every fixture an adult profile; this suite needs a
    // bare account to start from.
    mustSucceed('drop profile', await admin.from('customer_profiles').delete().eq('user_id', buyerUser.id))
    await signInAs(buyer, buyerUser.email)
    await signInAs(other, otherUser.email)
  })

  afterAll(async () => {
    if (!admin) return
    const emails = [buyerUser?.email, otherUser?.email].filter(Boolean)
    if (emails.length) await admin.from('orders').delete().in('customer_email', emails)
    await admin.from('products').delete().eq('slug', SLUG)
    await deleteTestUsers(admin, buyerUser?.id, otherUser?.id) // cascades to customer_profiles
  })

  it('NEGATIVE: no date of birth on record, no order', async () => {
    expect((await buyer.rpc('my_age_verified')).data).toBe(false)
    const { error } = await order()
    expect(error?.message).toMatch(/^Age check:/)
  })

  it('NEGATIVE: an under-21 date of birth is rejected', async () => {
    const { error } = await buyer.rpc('set_date_of_birth', { p_dob: yearsAgo(20) })
    expect(error?.message).toMatch(/21 or older/)
  })

  it('POSITIVE: a 21+ date of birth is accepted, then the order goes through', async () => {
    const { error } = await buyer.rpc('set_date_of_birth', { p_dob: yearsAgo(30) })
    expect(error).toBeNull()
    expect((await buyer.rpc('my_age_verified')).data).toBe(true)
    const placed = await order()
    expect(placed.error).toBeNull()
    expect(placed.data?.order_number).toMatch(/^224-/)
  })

  it('NEGATIVE: the date of birth cannot be changed once on record', async () => {
    const { error } = await buyer.rpc('set_date_of_birth', { p_dob: yearsAgo(40) })
    expect(error?.message).toMatch(/already on record/)
  })

  it('NEGATIVE: anon and other customers cannot read the profile', async () => {
    const a = await anon.from('customer_profiles').select('*').eq('user_id', buyerUser.id)
    expect(a.data ?? []).toEqual([])
    const o = await other.from('customer_profiles').select('*').eq('user_id', buyerUser.id)
    expect(o.data ?? []).toEqual([])
    const mine = await buyer.from('customer_profiles').select('user_id').eq('user_id', buyerUser.id)
    expect(mine.data).toHaveLength(1)
  })
})

describeGate('Age verification contract', gate)
