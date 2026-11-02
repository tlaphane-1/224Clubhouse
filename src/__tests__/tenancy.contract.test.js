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
  probeMigration, describeGate, ensureTestTenant, tenantClient,
  createTenantUser, signInClient, TEST_TENANT, TEST_PASSWORD,
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

// ---------------------------------------------------------------------------
// Task 3 — tenancy core
//
// 20261102110000_tenancy_core adds the `tenants` table and the helpers every
// later policy builds on. current_tenant() resolves, in order: the signed-in
// user's JWT app_metadata.tenant (authoritative, cannot be overridden by a
// header), the anon `x-tenant` request header, then default_tenant() so 224
// keeps working unchanged. The tenants table is world-readable and has no write
// policy: only the service role writes.
// ---------------------------------------------------------------------------
const coreGate = await probeMigration({
  migration: '20261102110000_tenancy_core',
  label: 'tenancy_applied()',
  probe: () => anonClient().rpc('tenancy_applied'),
})
const CORE_SKIP = !coreGate.applied

describeGate('Tenancy core contract', coreGate)

describe.skipIf(CORE_SKIP)('Tenancy contract — tenancy core', () => {
  const admin = CORE_SKIP ? null : serviceClient()
  let userId = null
  let userEmail = null

  beforeAll(async () => {
    await ensureTestTenant(admin)
    const user = await createTenantUser(admin, 'tenancy-core', TEST_TENANT)
    userId = user.id
    userEmail = user.email
  })

  afterAll(async () => {
    if (!admin) return
    await deleteTestUsers(admin, userId)
  })

  it('anon with no header resolves to the default tenant', async () => {
    const { data, error } = await anonClient().rpc('current_tenant')
    expect(error).toBeNull()
    expect(data).toBe('224clubhouse')
  })

  it('anon x-tenant header selects the tenant', async () => {
    const { data, error } = await tenantClient(TEST_TENANT).rpc('current_tenant')
    expect(error).toBeNull()
    expect(data).toBe(TEST_TENANT)
  })

  it('a signed-in user JWT claim beats a conflicting x-tenant header', async () => {
    const client = await signInClient(userEmail, TEST_PASSWORD, { tenant: '224clubhouse' })
    const { data, error } = await client.rpc('current_tenant')
    expect(error).toBeNull()
    expect(data).toBe(TEST_TENANT)
  })

  it('tenant_min_age is 21 for the default tenant and 18 for vitest-b', async () => {
    const def = await anonClient().rpc('tenant_min_age')
    expect(def.error).toBeNull()
    expect(def.data).toBe(21)
    const other = await tenantClient(TEST_TENANT).rpc('tenant_min_age')
    expect(other.error).toBeNull()
    expect(other.data).toBe(18)
  })

  it('tenant_order_prefix is 224 for the default tenant', async () => {
    const { data, error } = await anonClient().rpc('tenant_order_prefix')
    expect(error).toBeNull()
    expect(data).toBe('224')
  })

  it('NEGATIVE: anon cannot write to tenants', async () => {
    const { error } = await anonClient()
      .from('tenants')
      .insert({ slug: testSlug('rogue'), name: 'Rogue', order_prefix: 'RGE', min_age: 18 })
    expect(error).not.toBeNull()
  })

  it('NEGATIVE: a signed-in user cannot update tenants', async () => {
    const client = await signInClient(userEmail, TEST_PASSWORD)
    const { data } = await client.from('tenants').update({ min_age: 25 }).eq('slug', TEST_TENANT).select()
    expect(data ?? []).toHaveLength(0)
    const { data: row } = await admin.from('tenants').select('min_age').eq('slug', TEST_TENANT).single()
    expect(row.min_age).toBe(18)
  })
})
