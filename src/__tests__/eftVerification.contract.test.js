/**
 * Live-DB contract test for 20261007120000_eft_payment_verification.
 *
 *   NEGATIVE — an unpaid EFT order cannot move to Preparing (dispatch gate).
 *   POSITIVE — it can still be Confirmed.
 *   POSITIVE — the buyer uploads proof into their own folder and attaches it.
 *   NEGATIVE — another customer can't upload into the buyer's folder, can't
 *              attach to the buyer's order, and can't read the proof; anon
 *              can't read it either (private bucket).
 *   NEGATIVE — a customer can't mark their own order paid.
 *   POSITIVE — an admin marks it paid; it can then move to Preparing; /track
 *              returns paid_at.
 *   NEGATIVE — the payment can't be undone once the order is Preparing.
 *
 * How to run (PowerShell):
 *   npx vitest run src/__tests__/eftVerification.contract.test.js
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  anonClient, serviceClient, probeMigration, describeGate,
  testSlug, createTestUser, signInAs, deleteTestUsers, mustSucceed,
} from './helpers/liveFixtures.js'

const gate = await probeMigration({
  migration: '20261007120000_eft_payment_verification',
  label: 'eft_verification_applied()',
  probe: () => anonClient().rpc('eft_verification_applied'),
})
const SKIP = !gate.applied

const admin = SKIP ? null : serviceClient()
const buyer = SKIP ? null : anonClient()
const other = SKIP ? null : anonClient()
const adminClient = SKIP ? null : anonClient()
const anon = SKIP ? null : anonClient()

const SLUG = testSlug('eft-product')
const PDF = new TextEncoder().encode('%PDF-1.4\n% vitest proof\n')
let productId, buyerUser, otherUser, adminUser, orderId, orderNumber, proofPath

describe.skipIf(SKIP)('EFT verification contract', () => {
  beforeAll(async () => {
    productId = mustSucceed('create product', await admin.from('products').insert({
      name: `Vitest EFT ${SLUG}`, slug: SLUG, price: 10000, category: 'accessories',
      stock_quantity: 5, is_available: true,
    }).select('id').single()).id

    buyerUser = await createTestUser(admin, 'eft-buyer')
    otherUser = await createTestUser(admin, 'eft-other')
    adminUser = await createTestUser(admin, 'eft-admin')
    mustSucceed('grant admin', await admin.from('admin_users').insert({ id: adminUser.id, email: adminUser.email }))
    await signInAs(buyer, buyerUser.email)
    await signInAs(other, otherUser.email)
    await signInAs(adminClient, adminUser.email)

    const { data, error } = await buyer.rpc('place_cod_order', {
      p_customer: {
        name: 'Vitest EFT', email: buyerUser.email, phone: '0000000000', street: '1 Test St',
        apartment: '', city: 'Boksburg', province: 'Gauteng', postalCode: '1459',
      },
      p_items: [{ id: productId, quantity: 1 }],
      p_payment_method: 'eft',
    })
    expect(error).toBeNull()
    orderNumber = data.order_number
    orderId = data.id
    proofPath = `${buyerUser.id}/${orderId}/proof.pdf`
  })

  afterAll(async () => {
    if (!admin) return
    if (buyerUser) {
      const { data: files } = await admin.storage.from('payment-proofs').list(`${buyerUser.id}/${orderId}`)
      const paths = (files ?? []).map(f => `${buyerUser.id}/${orderId}/${f.name}`)
      if (paths.length) await admin.storage.from('payment-proofs').remove(paths)
    }
    const emails = [buyerUser?.email, otherUser?.email, adminUser?.email].filter(Boolean)
    if (emails.length) await admin.from('orders').delete().in('customer_email', emails)
    await admin.from('products').delete().eq('slug', SLUG)
    await deleteTestUsers(admin, buyerUser?.id, otherUser?.id, adminUser?.id)
  })

  it('NEGATIVE: an unpaid EFT order cannot move to Preparing', async () => {
    const { error } = await adminClient.rpc('admin_update_order_status', { p_order_id: orderId, p_status: 'preparing' })
    expect(error?.message).toMatch(/EFT payment not confirmed/i)
  })

  it('POSITIVE: an unpaid EFT order can still be Confirmed', async () => {
    const { error } = await adminClient.rpc('admin_update_order_status', { p_order_id: orderId, p_status: 'confirmed' })
    expect(error).toBeNull()
  })

  it('NEGATIVE: another customer cannot upload into the buyer\'s folder', async () => {
    const { error } = await other.storage.from('payment-proofs')
      .upload(`${buyerUser.id}/${orderId}/evil.pdf`, PDF, { contentType: 'application/pdf' })
    expect(error).not.toBeNull()
  })

  it('NEGATIVE: another customer cannot upload into their own folder for the buyer\'s order', async () => {
    const { error } = await other.storage.from('payment-proofs')
      .upload(`${otherUser.id}/${orderId}/evil.pdf`, PDF, { contentType: 'application/pdf' })
    expect(error).not.toBeNull()
  })

  it('POSITIVE: the buyer uploads and attaches a proof', async () => {
    const up = await buyer.storage.from('payment-proofs').upload(proofPath, PDF, { contentType: 'application/pdf' })
    expect(up.error).toBeNull()
    const { error } = await buyer.rpc('attach_payment_proof', { p_order_id: orderId, p_path: proofPath })
    expect(error).toBeNull()
    const row = mustSucceed('read order', await admin.from('orders')
      .select('payment_proof_path, payment_proof_uploaded_at').eq('id', orderId).single())
    expect(row.payment_proof_path).toBe(proofPath)
    expect(row.payment_proof_uploaded_at).toBeTruthy()
  })

  it('NEGATIVE: another customer cannot attach to the buyer\'s order', async () => {
    const { error } = await other.rpc('attach_payment_proof', { p_order_id: orderId, p_path: proofPath })
    expect(error?.message).toMatch(/not found/i)
  })

  it('NEGATIVE: other customers and anon cannot read the proof', async () => {
    const o = await other.storage.from('payment-proofs').createSignedUrl(proofPath, 60)
    expect(o.error).not.toBeNull()
    const a = await anon.storage.from('payment-proofs').createSignedUrl(proofPath, 60)
    expect(a.error).not.toBeNull()
  })

  it('POSITIVE: the admin can open the proof', async () => {
    const { data, error } = await adminClient.storage.from('payment-proofs').createSignedUrl(proofPath, 60)
    expect(error).toBeNull()
    expect(data.signedUrl).toMatch(/^https:/)
  })

  it('NEGATIVE: a customer cannot mark their own order paid', async () => {
    const { error } = await buyer.rpc('admin_set_eft_payment', { p_order_id: orderId, p_received: true })
    expect(error?.message).toMatch(/not authorized/i)
  })

  it('POSITIVE: admin marks paid, then the order can be prepared; /track shows paid_at', async () => {
    const { data, error } = await adminClient.rpc('admin_set_eft_payment', { p_order_id: orderId, p_received: true })
    expect(error).toBeNull()
    expect(data.paid_amount_cents).toBe(13000) // R100 + R30 delivery
    expect(data.short).toBe(false)

    const move = await adminClient.rpc('admin_update_order_status', { p_order_id: orderId, p_status: 'preparing' })
    expect(move.error).toBeNull()

    const track = await anon.rpc('get_order_tracking', { p_order_number: orderNumber, p_email: buyerUser.email })
    expect(track.error).toBeNull()
    expect(track.data.paid_at).toBeTruthy()
  })

  it('NEGATIVE: payment cannot be undone once the order is Preparing', async () => {
    const { error } = await adminClient.rpc('admin_set_eft_payment', { p_order_id: orderId, p_received: false })
    expect(error?.message).toMatch(/back to Confirmed/i)
  })
})

describeGate('EFT verification contract', gate)
