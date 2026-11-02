/**
 * Live-DB contract test for the multi-tenant database (phase 2).
 *
 * One `describe` per phase-2 task; later tasks append their own blocks below.
 * Each block owns its fixtures (set up in its own beforeAll, removed in its own
 * afterAll) so blocks can be added, removed or run alone without touching the
 * others.
 *
 * ISOLATION: every fixture carries RUN_TAG (see helpers/liveFixtures.js), so a
 * concurrent or orphaned run cannot delete another run's rows.
 *
 * Auto-skips unless BOTH VITE_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY
 * are set (service role is required for cleanup, so nothing is mutated without a
 * way to undo it).
 *
 * How to run against the local stack (PowerShell):
 *   $env:SUPABASE_BIN='C:/Users/azgcl/bin/supabase.exe.old-2.98.2'
 *   npm run test:local -- src/__tests__/tenancy.contract.test.js
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  KEYS_MISSING, anonClient, serviceClient, testSlug, createTestUser,
  signInAs, deleteTestUsers, mustSucceed,
} from './helpers/liveFixtures.js'

// ---------------------------------------------------------------------------
// Task 2 — decrement_stock is gone
//
// decrement_stock(product_id, qty) was a SECURITY DEFINER function left over
// from the initial schema. Nothing calls it (place_cod_order does its own
// stock arithmetic), but it stayed executable by every `authenticated` user, so
// any signed-in customer could lower any product's stock to zero. Migration
// 20261102100000_drop_decrement_stock removes it. With the function gone,
// PostgREST answers PGRST202 ("could not find the function in the schema
// cache") and no stock moves.
// ---------------------------------------------------------------------------
describe.skipIf(KEYS_MISSING)('Tenancy contract — decrement_stock is gone', () => {
  const START_STOCK = 5
  const PRODUCT_SLUG = testSlug('tenancy-decrement')
  const admin = KEYS_MISSING ? null : serviceClient()
  const userClient = KEYS_MISSING ? null : anonClient()
  let productId = null
  let userId = null

  beforeAll(async () => {
    const prod = mustSucceed('create test product', await admin
      .from('products')
      .insert({
        name: `Vitest Tenancy Product ${PRODUCT_SLUG}`,
        slug: PRODUCT_SLUG,
        price: 10000,
        category: 'accessories',
        stock_quantity: START_STOCK,
        is_available: true,
      })
      .select('id')
      .single())
    productId = prod.id

    const user = await createTestUser(admin, 'tenancy-decrement')
    userId = user.id
    await signInAs(userClient, user.email)
  })

  afterAll(async () => {
    if (!admin) return
    await admin.from('products').delete().eq('slug', PRODUCT_SLUG)
    await deleteTestUsers(admin, userId)
  })

  it('NEGATIVE: a signed-in user cannot call it (PGRST202) and stock is unchanged', async () => {
    const { error } = await userClient.rpc('decrement_stock', {
      product_id: productId,
      qty: 1,
    })
    expect(error?.code).toBe('PGRST202')

    const { data, error: readError } = await admin
      .from('products')
      .select('stock_quantity')
      .eq('id', productId)
      .single()
    expect(readError).toBeNull()
    expect(data.stock_quantity).toBe(START_STOCK)
  })
})
