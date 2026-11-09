/**
 * Live-DB contract test for 20261109130000_same_store_references.
 *
 *   POSITIVE — a child row in the same store as its parent is accepted.
 *   NEGATIVE — a child row pointing at another store's parent is refused
 *              (check_violation), even for the service role; an admin_users
 *              or drivers row cannot put a login into another store.
 *
 *   npm run test:local -- src/__tests__/sameStoreReferences.contract.test.js
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  anonClient, serviceClient, probeMigration, describeGate, createTestUser, deleteTestUsers,
  mustSucceed, ensureTestTenant, testSlug, TEST_TENANT,
} from './helpers/liveFixtures.js'

const gate = await probeMigration({
  migration: '20261109130000_same_store_references',
  label: 'same_store_references_applied()',
  probe: () => anonClient().rpc('same_store_references_applied'),
})
const SKIP = !gate.applied

const admin = SKIP ? null : serviceClient()
const SLUG = testSlug('same-store')
let productId, user

describe.skipIf(SKIP)('Same-store references contract', () => {
  beforeAll(async () => {
    await ensureTestTenant(admin)
    productId = mustSucceed('224 product', await admin.from('products').insert({
      name: `Vitest Same Store ${SLUG}`, slug: SLUG, price: 100, category: 'flower',
      stock_quantity: 0, is_available: false,
    }).select('id').single()).id
    user = await createTestUser(admin, 'same-store-login')
  })

  afterAll(async () => {
    if (!admin) return
    if (productId) await admin.from('products').delete().eq('id', productId)
    await deleteTestUsers(admin, user?.id)
  })

  it('POSITIVE: an option in the product\'s own store is accepted', async () => {
    mustSucceed('same-store option', await admin.from('product_variants')
      .insert({ product_id: productId, label: '1g', price: 100 }))
  })

  it('NEGATIVE: an option in another store, on a 224 product, is refused', async () => {
    const res = await admin.from('product_variants')
      .insert({ product_id: productId, label: '2g', price: 100, tenant: TEST_TENANT })
    expect(res.error?.code).toBe('23514')
  })

  it('NEGATIVE: moving an existing option to another store is refused', async () => {
    const res = await admin.from('product_variants')
      .update({ tenant: TEST_TENANT }).eq('product_id', productId).eq('label', '1g')
    expect(res.error?.code).toBe('23514')
  })

  it('NEGATIVE: a 224 login cannot be made another store\'s admin or driver', async () => {
    const asAdmin = await admin.from('admin_users').insert({ id: user.id, email: user.email, tenant: TEST_TENANT })
    expect(asAdmin.error?.code).toBe('23514')
    const asDriver = await admin.from('drivers').insert({ user_id: user.id, full_name: 'Vitest Driver', tenant: TEST_TENANT })
    expect(asDriver.error?.code).toBe('23514')
  })

  it('POSITIVE: a 224 login can be a 224 driver', async () => {
    mustSucceed('224 driver', await admin.from('drivers').insert({ user_id: user.id, full_name: 'Vitest Driver' }))
  })
})

describeGate('Same-store references contract', gate)
