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
import { randomUUID } from 'node:crypto'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import {
  anonClient, serviceClient, testSlug, createTestUser,
  signInAs, deleteTestUsers, mustSucceed,
  probeMigration, describeGate, ensureTestTenant, tenantClient,
  createTenantUser, signInClient, TEST_TENANT, TEST_PASSWORD, testCode, testEmail,
  URL, SERVICE, liveClientOptions, giveTenantProfile, yearsAgoIso,
  RUN_TAG, testEventTitle, findUserIdByEmail, grantPendingMembership,
} from './helpers/liveFixtures.js'

// Every block below is gated on a migration probe, so a deploy that runs this
// file before the phase-2 DB push skips it rather than failing. Task 2's block
// uses the tenancy_core probe: 20261102110000 ships in the same push as the
// drop (20261102100000) and lands after it.
const coreGate = await probeMigration({
  migration: '20261102110000_tenancy_core',
  label: 'tenancy_applied()',
  probe: () => anonClient().rpc('tenancy_applied'),
})
const CORE_SKIP = !coreGate.applied

describeGate('Tenancy core contract', coreGate)

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
describe.skipIf(CORE_SKIP)('Tenancy contract — decrement_stock is gone', () => {
  const START_STOCK = 5
  const PRODUCT_SLUG = testSlug('tenancy-decrement')
  const admin = CORE_SKIP ? null : serviceClient()
  const userClient = CORE_SKIP ? null : anonClient()
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
describe.skipIf(CORE_SKIP)('Tenancy contract — tenancy core', () => {
  const admin = CORE_SKIP ? null : serviceClient()
  let userId = null
  let userEmail = null
  let plainUserId = null
  let plainUserEmail = null

  beforeAll(async () => {
    await ensureTestTenant(admin)
    // No app_metadata.tenant: stands in for a 224 session issued before the
    // backfill. Since 20261102160000 every new account is stamped with a claim
    // at creation, so it is cleared here (Ruling 1's pattern). Without this the
    // forged-header test below would only prove "the claim beats the header".
    const plain = await createTestUser(admin, 'tenancy-core-plain')
    plainUserId = plain.id
    plainUserEmail = plain.email
    mustSucceed('clear plain claim', await admin.auth.admin
      .updateUserById(plainUserId, { app_metadata: { tenant: null } }))
    const user = await createTenantUser(admin, 'tenancy-core', TEST_TENANT)
    userId = user.id
    userEmail = user.email
  })

  afterAll(async () => {
    if (!admin) return
    await deleteTestUsers(admin, userId, plainUserId)
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

  it('a signed-in user with NO tenant claim ignores a forged x-tenant header', async () => {
    const client = await signInClient(plainUserEmail, TEST_PASSWORD, { tenant: TEST_TENANT })
    // Precondition: the session really is claimless (jwtPayload is a
    // module-scope const below; tests run after the module has loaded).
    expect((await jwtPayload(client)).app_metadata?.tenant ?? null).toBeNull()
    const { data, error } = await client.rpc('current_tenant')
    expect(error).toBeNull()
    expect(data).toBe('224clubhouse')
  })

  it('the service role (no auth.uid()) still follows the x-tenant header', async () => {
    const svc = createClient(URL, SERVICE, {
      ...liveClientOptions,
      global: { ...liveClientOptions.global, headers: { 'x-tenant': TEST_TENANT } },
    })
    const { data, error } = await svc.rpc('current_tenant')
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

// ---------------------------------------------------------------------------
// Task 4 — tenant columns and tenant-scoped uniques
//
// 20261102120000_tenant_columns adds `tenant` to the 19 store tables (existing
// rows backfill to 224clubhouse), swaps the four global uniques (products.slug,
// membership_tiers.slug, discount_codes.code, newsletter_subscribers.email) for
// (tenant, x) ones, and re-keys alert_settings by tenant. Two stores can now
// share a slug, a coupon code or a subscriber email; one store still cannot
// duplicate its own (23505).
// ---------------------------------------------------------------------------
const TENANT_TABLES = [
  'products', 'product_variants', 'product_reviews', 'events', 'event_reservations',
  'membership_tiers', 'memberships', 'orders', 'discount_codes', 'newsletter_subscribers',
  'contact_messages', 'saved_carts', 'site_events', 'customer_profiles',
  'customer_email_prefs', 'drivers', 'driver_locations', 'admin_users', 'alert_settings',
]

const columnsGate = await probeMigration({
  migration: '20261102120000_tenant_columns',
  label: 'products.tenant',
  probe: () => serviceClient().from('products').select('tenant').limit(1),
})
const COLUMNS_SKIP = !columnsGate.applied

describeGate('Tenant columns contract', columnsGate)

describe.skipIf(COLUMNS_SKIP)('Tenancy contract — tenant columns', () => {
  const admin = COLUMNS_SKIP ? null : serviceClient()
  const SLUG = testSlug('tenant-cols')
  const TIER_SLUG = testSlug('tenant-tier')
  const CODE = testCode('tenant-code')
  const EMAIL = testEmail('tenant-news')
  const SUB_EMAIL = testEmail('tenant-rpc')

  const cleanup = async () => {
    await admin.from('products').delete().like('slug', `${SLUG}%`)
    await admin.from('membership_tiers').delete().eq('slug', TIER_SLUG)
    await admin.from('discount_codes').delete().eq('code', CODE)
    await admin.from('newsletter_subscribers').delete().in('email', [EMAIL, SUB_EMAIL])
    await admin.from('alert_settings').delete().eq('tenant', TEST_TENANT)
  }

  beforeAll(async () => {
    await ensureTestTenant(admin)
    await cleanup()
  })

  afterAll(async () => {
    if (!admin) return
    await cleanup()
  })

  const product = (tenant, slug = SLUG) => ({
    name: `Vitest Tenant Product ${slug}`,
    slug,
    price: 10000,
    category: 'accessories',
    stock_quantity: 1,
    is_available: true,
    ...(tenant ? { tenant } : {}),
  })

  it.each(TENANT_TABLES)('%s has a tenant column', async (table) => {
    const { error } = await admin.from(table).select('tenant').limit(1)
    expect(error).toBeNull()
  })

  it('every existing row belongs to a known store (no NULL, no unknown tenant)', async () => {
    // A store is known when it has a tenants/<slug>/ folder: once a second
    // store (e.g. explosive420) is provisioned its rows are legitimate.
    const known = new Set(readdirSync(path.resolve(import.meta.dirname, '../../tenants'), { withFileTypes: true })
      .filter(d => d.isDirectory()).map(d => d.name))
    for (const table of TENANT_TABLES) {
      // Rows other suites park under vitest-b are removed by their owners; any
      // OTHER value (or NULL) means the backfill went wrong.
      const { data, error } = await admin.from(table).select('tenant').neq('tenant', '224clubhouse').limit(50)
      expect(error, table).toBeNull()
      const stray = (data ?? []).filter((r) => r.tenant !== TEST_TENANT && !known.has(r.tenant))
      expect(stray, table).toEqual([])
    }
  })

  it('a product inserted with no tenant gets 224clubhouse', async () => {
    const { data, error } = await admin.from('products').insert(product(null, `${SLUG}-def`)).select('tenant').single()
    expect(error).toBeNull()
    expect(data.tenant).toBe('224clubhouse')
  })

  it('NEGATIVE: tenant must reference an existing tenants row', async () => {
    const { error } = await admin.from('products').insert(product('no-such-store', `${SLUG}-fk`))
    expect(error?.code).toBe('23503')
  })

  it('products: same slug in two tenants is allowed, twice in one tenant is 23505', async () => {
    mustSucceed('product 224', await admin.from('products').insert(product('224clubhouse')).select('id').single())
    mustSucceed('product vitest-b', await admin.from('products').insert(product(TEST_TENANT)).select('id').single())
    expect((await admin.from('products').insert(product('224clubhouse'))).error?.code).toBe('23505')
    expect((await admin.from('products').insert(product(TEST_TENANT))).error?.code).toBe('23505')
  })

  it('membership_tiers: same slug in two tenants is allowed, twice in one tenant is 23505', async () => {
    const tier = (tenant) => ({
      slug: TIER_SLUG, name: 'Vitest Tier', price_cents: 100, duration_days: 30, tenant,
    })
    mustSucceed('tier 224', await admin.from('membership_tiers').insert(tier('224clubhouse')).select('id').single())
    mustSucceed('tier b', await admin.from('membership_tiers').insert(tier(TEST_TENANT)).select('id').single())
    expect((await admin.from('membership_tiers').insert(tier('224clubhouse'))).error?.code).toBe('23505')
  })

  it('discount_codes: same code in two tenants is allowed, twice in one tenant is 23505', async () => {
    const code = (tenant) => ({ code: CODE, kind: 'percent', value: 5, tenant })
    mustSucceed('code 224', await admin.from('discount_codes').insert(code('224clubhouse')).select('id').single())
    mustSucceed('code b', await admin.from('discount_codes').insert(code(TEST_TENANT)).select('id').single())
    expect((await admin.from('discount_codes').insert(code('224clubhouse'))).error?.code).toBe('23505')
  })

  it('newsletter_subscribers: same email in two tenants is allowed, twice in one tenant is 23505', async () => {
    const sub = (tenant) => ({ email: EMAIL, tenant })
    mustSucceed('sub 224', await admin.from('newsletter_subscribers').insert(sub('224clubhouse')).select('id').single())
    mustSucceed('sub b', await admin.from('newsletter_subscribers').insert(sub(TEST_TENANT)).select('id').single())
    expect((await admin.from('newsletter_subscribers').insert(sub('224clubhouse'))).error?.code).toBe('23505')
  })

  it('subscribe_newsletter still succeeds twice for the same email (upsert path), stamped 224clubhouse', async () => {
    const anon = anonClient()
    const first = await anon.rpc('subscribe_newsletter', { p_email: SUB_EMAIL })
    expect(first.error).toBeNull()
    expect(first.data).toMatchObject({ success: true, email: SUB_EMAIL })
    const second = await anon.rpc('subscribe_newsletter', { p_email: SUB_EMAIL })
    expect(second.error).toBeNull()
    expect(second.data).toMatchObject({ success: true, email: SUB_EMAIL })
    const { data } = await admin.from('newsletter_subscribers').select('tenant').eq('email', SUB_EMAIL)
    expect(data).toEqual([{ tenant: '224clubhouse' }])
  })

  it('subscribe_newsletter on another tenant creates a separate row for the same email', async () => {
    const res = await tenantClient(TEST_TENANT).rpc('subscribe_newsletter', { p_email: SUB_EMAIL })
    expect(res.error).toBeNull()
    const { data } = await admin
      .from('newsletter_subscribers').select('tenant').eq('email', SUB_EMAIL).order('tenant')
    expect(data.map((r) => r.tenant)).toEqual(['224clubhouse', TEST_TENANT])
  })

  it('alert_settings is keyed by tenant: the 224 row keeps id 1, a second tenant needs no id', async () => {
    const { data: row } = await admin.from('alert_settings').select('id, tenant').eq('tenant', '224clubhouse').single()
    expect(row).toEqual({ id: 1, tenant: '224clubhouse' })
    const ins = await admin.from('alert_settings').insert({ tenant: TEST_TENANT }).select('id, tenant').single()
    expect(ins.error).toBeNull()
    expect(ins.data).toEqual({ id: null, tenant: TEST_TENANT })
    const dupe = await admin.from('alert_settings').insert({ tenant: TEST_TENANT })
    expect(dupe.error?.code).toBe('23505')
  })
})

// ---------------------------------------------------------------------------
// Task 5 — tenant isolation through RLS
//
// 20261102130000_tenant_policies makes is_admin()/is_driver() tenant-aware and
// ANDs `tenant = (select public.current_tenant())` onto every policy on the 19
// tenant tables, plus the four payment-proofs storage policies. Each store now
// sees only its own rows; 224 (the default tenant) sees exactly what it saw.
//
// Every user here except the "old session" one carries an app_metadata.tenant
// claim. Admin and driver rows are written by the service role with an
// explicit tenant. The admin_users insert trigger (admin_becomes_driver) gives
// each admin a drivers row in the admin_users row's tenant (Task 6).
// ---------------------------------------------------------------------------
const jwtPayload = async (client) => {
  const { data } = await client.auth.getSession()
  const token = data.session?.access_token
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
}

describe.skipIf(COLUMNS_SKIP)('Tenancy contract — tenant isolation — tables', () => {
  const admin = COLUMNS_SKIP ? null : serviceClient()
  const SLUG = testSlug('tiso')
  const SLUG_224 = `${SLUG}-224`
  const SLUG_B = `${SLUG}-b`
  const CONTACT_EMAIL = testEmail('tiso-contact')
  const NEWS_EMAIL = testEmail('tiso-news')
  const PDF = new TextEncoder().encode('%PDF-1.4\n% vitest tenancy proof\n')

  const u = {} // label -> { id, email }
  const c = {} // label -> signed-in client
  const order = {} // label -> order id
  const product = {} // tenant -> product id
  const proof = {} // label -> storage path

  const makeOrder = async (label, user, tenant, paymentMethod) => {
    const row = mustSucceed(`order ${label}`, await admin.from('orders').insert({
      customer_name: `Vitest Tenancy ${label}`,
      customer_email: user.email,
      customer_phone: '0000000000',
      items: [],
      subtotal: 10000,
      shipping_fee: 0,
      total: 10000,
      shipping_address: { street: '1 Test St', city: 'Boksburg' },
      payment_method: paymentMethod,
      user_id: user.id,
      tenant,
    }).select('id').single())
    return row.id
  }

  // The admin_becomes_driver trigger stamps the drivers row with the
  // admin_users row's tenant (20261102140000), so no hand correction is needed.
  const makeAdmin = async (user, tenant) => {
    mustSucceed(`grant admin ${user.email}`, await admin.from('admin_users')
      .insert({ id: user.id, email: user.email, tenant }))
  }

  beforeAll(async () => {
    await ensureTestTenant(admin)

    for (const [tenant, slug] of [['224clubhouse', SLUG_224], [TEST_TENANT, SLUG_B]]) {
      product[tenant] = mustSucceed(`product ${tenant}`, await admin.from('products').insert({
        name: `Vitest Tenancy ${slug}`, slug, price: 10000, category: 'accessories',
        stock_quantity: 5, is_available: true, tenant,
      }).select('id').single()).id
    }

    u.cust224 = await createTenantUser(admin, 'tiso-cust224', '224clubhouse')
    u.custB = await createTenantUser(admin, 'tiso-custb', TEST_TENANT)
    u.admin224 = await createTenantUser(admin, 'tiso-admin224', '224clubhouse')
    u.adminB = await createTenantUser(admin, 'tiso-adminb', TEST_TENANT)
    // A 224 user whose admin_users and drivers rows belong to vitest-b: proves
    // is_admin()/is_driver() check the row's tenant, not just its existence.
    u.crossed = await createTenantUser(admin, 'tiso-crossed', '224clubhouse')
    // Old session: no tenant claim at all (Ruling 1 — clear it explicitly so the
    // test still means this after Task 8 stamps every new user).
    u.old = await createTestUser(admin, 'tiso-old')
    mustSucceed('clear old-session claim', await admin.auth.admin
      .updateUserById(u.old.id, { app_metadata: { tenant: null } }))

    await makeAdmin(u.admin224, '224clubhouse')
    await makeAdmin(u.adminB, TEST_TENANT)
    await makeAdmin(u.crossed, TEST_TENANT)

    order.cust224 = await makeOrder('cust224', u.cust224, '224clubhouse', 'eft')
    order.custB = await makeOrder('custb', u.custB, TEST_TENANT, 'eft')
    order.old = await makeOrder('old', u.old, '224clubhouse', 'cash_on_delivery')

    for (const label of Object.keys(u)) {
      c[label] = await signInClient(u[label].email, TEST_PASSWORD)
    }
    // The 224 admin forges the other store's header (Review Focus 2).
    c.admin224Forged = await signInClient(u.admin224.email, TEST_PASSWORD, { tenant: TEST_TENANT })

    proof.cust224 = `${u.cust224.id}/${order.cust224}/proof.pdf`
    proof.custB = `${u.custB.id}/${order.custB}/proof.pdf`
    mustSucceed('upload 224 proof', await admin.storage.from('payment-proofs')
      .upload(proof.cust224, PDF, { contentType: 'application/pdf' }))
  })

  afterAll(async () => {
    if (!admin) return
    const users = Object.values(u)
    for (const user of [u.cust224, u.custB]) {
      if (!user) continue
      const { data: dirs } = await admin.storage.from('payment-proofs').list(user.id)
      for (const d of dirs ?? []) {
        const { data: files } = await admin.storage.from('payment-proofs').list(`${user.id}/${d.name}`)
        const paths = (files ?? []).map((f) => `${user.id}/${d.name}/${f.name}`)
        if (paths.length) await admin.storage.from('payment-proofs').remove(paths)
      }
    }
    const emails = users.map((x) => x.email)
    if (emails.length) await admin.from('orders').delete().in('customer_email', emails)
    if (emails.length) await admin.from('memberships').delete().in('email', emails)
    await admin.from('products').delete().like('slug', `${SLUG}%`)
    await admin.from('contact_messages').delete().eq('email', CONTACT_EMAIL)
    await admin.from('newsletter_subscribers').delete().eq('email', NEWS_EMAIL)
    // Cascades to admin_users and drivers.
    await deleteTestUsers(admin, ...users.map((x) => x.id))
  })

  const productSlugs = async (client) => {
    const { data, error } = await client.from('products').select('slug').like('slug', `${SLUG}%`)
    expect(error).toBeNull()
    return (data ?? []).map((r) => r.slug).sort()
  }

  const orderIds = async (client) => {
    const { data, error } = await client.from('orders').select('id')
      .in('id', [order.cust224, order.custB, order.old])
    expect(error).toBeNull()
    return (data ?? []).map((r) => r.id).sort()
  }

  it('anon with no header sees only the 224 product; x-tenant vitest-b sees only its own', async () => {
    expect(await productSlugs(anonClient())).toEqual([SLUG_224])
    expect(await productSlugs(tenantClient(TEST_TENANT))).toEqual([SLUG_B])
  })

  it('each customer sees only their own order', async () => {
    expect(await orderIds(c.cust224)).toEqual([order.cust224])
    expect(await orderIds(c.custB)).toEqual([order.custB])
  })

  it('each admin sees their own store\'s orders and not the other store\'s', async () => {
    const seen224 = await orderIds(c.admin224)
    expect(seen224).toContain(order.cust224)
    expect(seen224).not.toContain(order.custB)
    expect(await orderIds(c.adminB)).toEqual([order.custB])
  })

  it('NEGATIVE: the 224 admin forging x-tenant: vitest-b still sees no vitest-b order (Review Focus 2)', async () => {
    const seen = await orderIds(c.admin224Forged)
    expect(seen).not.toContain(order.custB)
    expect(seen).toContain(order.cust224)
  })

  it('is_admin() is true for each admin in their own store', async () => {
    for (const client of [c.admin224, c.adminB, c.admin224Forged]) {
      const { data, error } = await client.rpc('is_admin')
      expect(error).toBeNull()
      expect(data).toBe(true)
    }
  })

  it('NEGATIVE: is_admin() is false when the admin row belongs to another store', async () => {
    const { data, error } = await c.crossed.rpc('is_admin')
    expect(error).toBeNull()
    expect(data).toBe(false)
    expect(await orderIds(c.crossed)).toEqual([])
  })

  it('is_driver() follows the drivers row\'s store', async () => {
    const own = await c.adminB.rpc('is_driver')
    expect(own.error).toBeNull()
    expect(own.data).toBe(true)
    const crossed = await c.crossed.rpc('is_driver')
    expect(crossed.error).toBeNull()
    expect(crossed.data).toBe(false)
  })

  it('NEGATIVE: anon (224) contact insert naming vitest-b is rejected; with no tenant it succeeds (Review Focus 3)', async () => {
    const anon = tenantClient('224clubhouse')
    const msg = { name: 'Vitest Tenancy', email: CONTACT_EMAIL, message: 'tenancy probe' }
    const forged = await anon.from('contact_messages').insert({ ...msg, tenant: TEST_TENANT })
    expect(forged.error?.code).toBe('42501')
    const plain = await anon.from('contact_messages').insert(msg)
    expect(plain.error).toBeNull()
    const { data } = await admin.from('contact_messages').select('tenant').eq('email', CONTACT_EMAIL)
    expect(data).toEqual([{ tenant: '224clubhouse' }])
  })

  it('NEGATIVE: anon (224) newsletter insert naming vitest-b is rejected; with no tenant it succeeds (Review Focus 3)', async () => {
    const anon = tenantClient('224clubhouse')
    const forged = await anon.from('newsletter_subscribers').insert({ email: NEWS_EMAIL, tenant: TEST_TENANT })
    expect(forged.error?.code).toBe('42501')
    const plain = await anon.from('newsletter_subscribers').insert({ email: NEWS_EMAIL })
    expect(plain.error).toBeNull()
    const { data } = await admin.from('newsletter_subscribers').select('tenant').eq('email', NEWS_EMAIL)
    expect(data).toEqual([{ tenant: '224clubhouse' }])
  })

  it('a 224 user with no tenant claim (old session) still reads their own 224 order (Review Focus 1)', async () => {
    const claims = await jwtPayload(c.old)
    expect(claims.app_metadata?.tenant ?? null).toBeNull()
    expect(await orderIds(c.old)).toEqual([order.old])
  })

  it('NEGATIVE CONTROL: the vitest-b admin cannot update the 224 product (0 rows, unchanged)', async () => {
    const { data, error } = await c.adminB.from('products')
      .update({ stock_quantity: 0 }).eq('id', product['224clubhouse']).select('id')
    expect(error).toBeNull()
    expect(data ?? []).toHaveLength(0)
    const { data: row } = await admin.from('products').select('stock_quantity')
      .eq('id', product['224clubhouse']).single()
    expect(row.stock_quantity).toBe(5)
  })

  it('NEGATIVE: the vitest-b admin cannot open or delete a 224 payment proof; the 224 admin can open it', async () => {
    const other = await c.adminB.storage.from('payment-proofs').createSignedUrl(proof.cust224, 60)
    expect(other.error).not.toBeNull()
    await c.adminB.storage.from('payment-proofs').remove([proof.cust224])
    const { data: still } = await admin.storage.from('payment-proofs').list(`${u.cust224.id}/${order.cust224}`)
    expect((still ?? []).map((f) => f.name)).toContain('proof.pdf')

    const own = await c.admin224.storage.from('payment-proofs').createSignedUrl(proof.cust224, 60)
    expect(own.error).toBeNull()
  })

  it('a vitest-b customer uploads a proof for their own order; only the vitest-b admin can open it', async () => {
    const up = await c.custB.storage.from('payment-proofs')
      .upload(proof.custB, PDF, { contentType: 'application/pdf' })
    expect(up.error).toBeNull()
    const self = await c.custB.storage.from('payment-proofs').createSignedUrl(proof.custB, 60)
    expect(self.error).toBeNull()
    const own = await c.adminB.storage.from('payment-proofs').createSignedUrl(proof.custB, 60)
    expect(own.error).toBeNull()
    const other = await c.admin224.storage.from('payment-proofs').createSignedUrl(proof.custB, 60)
    expect(other.error).not.toBeNull()
  })

  // Last in this block: it moves the 224 product's stock, which the negative
  // control above asserts is unchanged.
  it('a 224 user with no tenant claim (old session) can still check out and gets a 224- order (Review Focus 1)', async () => {
    expect((await jwtPayload(c.old)).app_metadata?.tenant ?? null).toBeNull()
    // u.old already has order.old, and a second order needs a membership
    // application (20261001120000). Pending: active would change the fees.
    await grantPendingMembership(admin, u.old)
    const res = await c.old.rpc('place_cod_order', {
      p_customer: {
        name: 'Vitest Tenancy old', email: u.old.email, phone: '0000000000', street: '1 Test St',
        apartment: '', city: 'Boksburg', province: 'Gauteng', postalCode: '1459',
      },
      p_items: [{ id: product['224clubhouse'], quantity: 1 }],
      p_payment_method: 'cash_on_delivery',
    })
    expect(res.error).toBeNull()
    expect(res.data.order_number).toMatch(/^224-/)
    // Removed in afterAll with the other orders (place_cod_order stamps the
    // account email).
    const { data: row } = await admin.from('orders').select('tenant, user_id, customer_email')
      .eq('id', res.data.id).single()
    expect(row).toEqual({ tenant: '224clubhouse', user_id: u.old.id, customer_email: u.old.email })
  })
})

// ---------------------------------------------------------------------------
// Task 6 — tenant-scoped order, discount, review and driver RPCs
//
// 20261102140000_tenant_rpcs_orders scopes the SECURITY DEFINER RPCs that
// bypass RLS. place_cod_order reads only the current store's products, profile,
// memberships and discount codes, prefixes the order number with
// tenant_order_prefix() and checks tenant_min_age(). Tracking and admin RPCs
// treat another store's order exactly like a missing one.
// ---------------------------------------------------------------------------
describe.skipIf(COLUMNS_SKIP)('Tenancy contract — tenant isolation — orders and discounts', () => {
  const admin = COLUMNS_SKIP ? null : serviceClient()
  const SLUG = testSlug('trpc')
  const CODE = testCode('same')
  // The exact text 224 customers see today (20261008120000). Must not change.
  const AGE_MESSAGE_224 = 'Age check: please confirm your date of birth before ordering'

  const u = {} // label -> { id, email }
  const c = {} // label -> signed-in client
  const product = {} // tenant -> product id
  const placed = {} // label -> { id, order_number }

  const payload = (user, productId, extra = {}) => ({
    p_customer: {
      name: 'Vitest Tenancy', email: user.email, phone: '0000000000', street: '1 Test St',
      apartment: '', city: 'Boksburg', province: 'Gauteng', postalCode: '1459',
    },
    p_items: [{ id: productId, quantity: 1 }],
    p_payment_method: 'cash_on_delivery',
    ...extra,
  })

  beforeAll(async () => {
    await ensureTestTenant(admin)

    for (const [tenant, slug] of [['224clubhouse', `${SLUG}-224`], [TEST_TENANT, `${SLUG}-b`]]) {
      product[tenant] = mustSucceed(`product ${tenant}`, await admin.from('products').insert({
        name: `Vitest Tenancy ${slug}`, slug, price: 10000, category: 'accessories',
        stock_quantity: 10, is_available: true, tenant,
      }).select('id').single()).id
    }

    // Same code in both stores, different values (Review Focus 4).
    mustSucceed('code 224', await admin.from('discount_codes')
      .insert({ code: CODE, kind: 'percent', value: 5, tenant: '224clubhouse' }))
    mustSucceed('code b', await admin.from('discount_codes')
      .insert({ code: CODE, kind: 'percent', value: 15, tenant: TEST_TENANT }))

    u.cust224 = await createTenantUser(admin, 'trpc-cust224', '224clubhouse')
    u.custB = await createTenantUser(admin, 'trpc-custb', TEST_TENANT)
    u.crossB = await createTenantUser(admin, 'trpc-crossb', TEST_TENANT)
    u.young224 = await createTenantUser(admin, 'trpc-young224', '224clubhouse')
    u.youngB = await createTenantUser(admin, 'trpc-youngb', TEST_TENANT)
    u.admin224 = await createTenantUser(admin, 'trpc-admin224', '224clubhouse')
    u.adminB = await createTenantUser(admin, 'trpc-adminb', TEST_TENANT)
    // 19 today: old enough for vitest-b (18), too young for 224 (21).
    await giveTenantProfile(admin, u.young224.id, '224clubhouse', yearsAgoIso(19))
    await giveTenantProfile(admin, u.youngB.id, TEST_TENANT, yearsAgoIso(19))

    mustSucceed('admin 224', await admin.from('admin_users')
      .insert({ id: u.admin224.id, email: u.admin224.email, tenant: '224clubhouse' }))
    mustSucceed('admin b', await admin.from('admin_users')
      .insert({ id: u.adminB.id, email: u.adminB.email, tenant: TEST_TENANT }))

    for (const label of Object.keys(u)) {
      c[label] = await signInClient(u[label].email, TEST_PASSWORD)
    }
  })

  afterAll(async () => {
    if (!admin) return
    const emails = Object.values(u).map((x) => x.email)
    if (emails.length) await admin.from('orders').delete().in('customer_email', emails)
    await admin.from('products').delete().like('slug', `${SLUG}%`)
    await admin.from('discount_codes').delete().eq('code', CODE)
    // Cascades to customer_profiles, admin_users and drivers.
    await deleteTestUsers(admin, ...Object.values(u).map((x) => x.id))
  })

  const ordersOf = async (user) => {
    const { data, error } = await admin.from('orders')
      .select('id, order_number, tenant, status').eq('user_id', user.id)
    expect(error).toBeNull()
    return data ?? []
  }

  it('a vitest-b customer gets a VTB- order in vitest-b; a 224 customer still gets 224-', async () => {
    const b = await c.custB.rpc('place_cod_order', payload(u.custB, product[TEST_TENANT]))
    expect(b.error).toBeNull()
    expect(b.data.order_number).toMatch(/^VTB-/)
    placed.custB = b.data

    const own = await c.cust224.rpc('place_cod_order', payload(u.cust224, product['224clubhouse']))
    expect(own.error).toBeNull()
    expect(own.data.order_number).toMatch(/^224-/)
    placed.cust224 = own.data

    const rows = await ordersOf(u.custB)
    expect(rows.map((r) => r.tenant)).toEqual([TEST_TENANT])
    expect((await ordersOf(u.cust224)).map((r) => r.tenant)).toEqual(['224clubhouse'])
  })

  it('NEGATIVE: a vitest-b customer ordering a 224 product id gets "Product not found" and no order row', async () => {
    const res = await c.crossB.rpc('place_cod_order', payload(u.crossB, product['224clubhouse']))
    expect(res.data).toBeNull()
    expect(res.error?.message).toBe('Product not found')
    expect(await ordersOf(u.crossB)).toEqual([])
    const { data: row } = await admin.from('products').select('stock_quantity')
      .eq('id', product['224clubhouse']).single()
    // Only the 224 customer's own order moved 224 stock.
    expect(row.stock_quantity).toBe(9)
  })

  it('get_order_tracking: the vitest-b order is invisible to 224 anon and visible to vitest-b anon', async () => {
    const args = { p_order_number: placed.custB.order_number, p_email: u.custB.email }
    const from224 = await anonClient().rpc('get_order_tracking', args)
    expect(from224.error).toBeNull()
    expect(from224.data ?? null).toBeNull()

    const fromB = await tenantClient(TEST_TENANT).rpc('get_order_tracking', args)
    expect(fromB.error).toBeNull()
    expect(fromB.data?.order_number).toBe(placed.custB.order_number)
  })

  it('the same code in two stores: each customer gets their own store\'s value (Review Focus 4)', async () => {
    const own = await c.cust224.rpc('validate_discount_code', { p_code: CODE, p_subtotal_cents: 10000 })
    expect(own.error).toBeNull()
    expect(own.data).toMatchObject({ valid: true, value: 5, discount_cents: 500 })

    const b = await c.custB.rpc('validate_discount_code', { p_code: CODE, p_subtotal_cents: 10000 })
    expect(b.error).toBeNull()
    expect(b.data).toMatchObject({ valid: true, value: 15, discount_cents: 1500 })
  })

  it('NEGATIVE: the 224 admin cannot change the vitest-b order\'s status (Order not found, row unchanged)', async () => {
    const res = await c.admin224.rpc('admin_update_order_status', {
      p_order_id: placed.custB.id, p_status: 'cancelled',
    })
    expect(res.error?.message).toBe('Order not found')
    const { data: row } = await admin.from('orders').select('status').eq('id', placed.custB.id).single()
    expect(row.status).toBe('pending')
  })

  it('a 19-year-old orders in vitest-b (min age 18); a 19-year-old in 224 gets 224\'s exact age message (Review Focus 5)', async () => {
    const b = await c.youngB.rpc('place_cod_order', payload(u.youngB, product[TEST_TENANT]))
    expect(b.error).toBeNull()
    expect(b.data.order_number).toMatch(/^VTB-/)

    const own = await c.young224.rpc('place_cod_order', payload(u.young224, product['224clubhouse']))
    expect(own.data).toBeNull()
    expect(own.error?.message).toBe(AGE_MESSAGE_224)
    expect(await ordersOf(u.young224)).toEqual([])
  })

  it('NEGATIVE: a claim naming a store with no tenants row fails closed ("Unknown store", no order) (Ruling 8)', async () => {
    // Adult 224 profile from createTestUser; only the claim points nowhere, so
    // tenant_min_age()/tenant_order_prefix() are NULL for this session.
    u.ghost = await createTestUser(admin, 'trpc-ghost')
    mustSucceed('ghost claim', await admin.auth.admin
      .updateUserById(u.ghost.id, { app_metadata: { tenant: 'no-such-store' } }))
    const ghost = await signInClient(u.ghost.email, TEST_PASSWORD)
    const res = await ghost.rpc('place_cod_order', payload(u.ghost, product['224clubhouse']))
    expect(res.data).toBeNull()
    expect(res.error?.message).toBe('Unknown store')
    expect(await ordersOf(u.ghost)).toEqual([])
  })

  it('admin_becomes_driver stamps each admin\'s drivers row with the admin_users row\'s tenant (Ruling 11)', async () => {
    const { data, error } = await admin.from('drivers').select('user_id, tenant')
      .in('user_id', [u.admin224.id, u.adminB.id])
    expect(error).toBeNull()
    const byUser = Object.fromEntries((data ?? []).map((r) => [r.user_id, r.tenant]))
    expect(byUser).toEqual({ [u.admin224.id]: '224clubhouse', [u.adminB.id]: TEST_TENANT })
  })
})

// ---------------------------------------------------------------------------
// Task 7 — tenant-aware membership, event, newsletter, cart, analytics, age
// and alert RPCs
//
// 20261102150000_tenant_rpcs_members scopes the remaining SECURITY DEFINER
// RPCs by tenant. Tier slugs resolve per store, the minimum age comes from the
// tenants row, analytics count only the caller's store, and alert settings
// (plus the Telegram vault secret name) are per store. 224's messages are
// byte-identical to today's; they are asserted literally below.
// ---------------------------------------------------------------------------
describe.skipIf(COLUMNS_SKIP)('Tenancy contract — tenant isolation — members, events, alerts', () => {
  const admin = COLUMNS_SKIP ? null : serviceClient()
  // The service role scoped to vitest-b, the way an Edge Function for that
  // store would be (no auth.uid(), so the x-tenant header is honoured).
  const serviceB = COLUMNS_SKIP ? null : createClient(URL, SERVICE, {
    ...liveClientOptions,
    global: { ...liveClientOptions.global, headers: { 'x-tenant': TEST_TENANT } },
  })
  // Today's 224 texts (20261005130000, 20260813150000, 20261008120000). Must not change.
  const MEMBERSHIP_AGE_224 = 'Must be 21 or older'
  const DOB_AGE_224 = 'Age check: you must be 21 or older to order'
  const B_DAILY_PRICE = 4321
  const B_DAILY_DAYS = 3
  const NEWS_EMAIL = testEmail('tmem-news')
  const CREATED_EMAIL_224 = testEmail('tmem-created224')
  const CREATED_EMAIL_B = testEmail('tmem-createdb')
  const PATH_224 = `/vitest-tenancy-${RUN_TAG}-224`
  const PATH_B = `/vitest-tenancy-${RUN_TAG}-b`

  const CONSENTS_21 = {
    age_21: true, private_club: true, no_redistribution: true,
    personal_use: true, code_of_conduct: true, release_liability: true,
  }
  const CONSENTS_MIN = {
    age_min: true, private_club: true, no_redistribution: true,
    personal_use: true, code_of_conduct: true, release_liability: true,
  }

  const application = (dob, consents = CONSENTS_21) => ({
    p_customer: {
      full_name: 'Vitest Member', phone: '0000000000', date_of_birth: dob,
      id_number: '9001015800085', residential_address: '1 Test Street, Boksburg',
      consumption_reasons: ['recreational'], consumption_other: null,
      consents, signature_image: null, signature_typed: 'Vitest Member',
    },
    p_tier: 'daily',
    p_reference: null,
  })

  const u = {} // label -> { id, email }
  const c = {} // label -> signed-in client
  const tier = {} // tenant -> { id, price_cents } of its daily tier
  const event = {} // tenant -> event id
  const state = {} // ids created by earlier tests
  // 224's alert_settings row exactly as found. Read only, never written: on
  // production it is the owner's live Telegram config.
  let alerts224 = null

  const dropBDailyTier = async () => {
    const { data } = await admin.from('membership_tiers').select('id')
      .eq('tenant', TEST_TENANT).eq('slug', 'daily')
    const ids = (data ?? []).map((r) => r.id)
    if (ids.length) {
      await admin.from('memberships').delete().in('tier_id', ids)
      await admin.from('membership_tiers').delete().in('id', ids)
    }
  }

  beforeAll(async () => {
    await ensureTestTenant(admin)
    await dropBDailyTier()
    await admin.from('alert_settings').delete().eq('tenant', TEST_TENANT)

    tier['224clubhouse'] = mustSucceed('224 daily tier', await admin.from('membership_tiers')
      .select('id, price_cents').eq('tenant', '224clubhouse').eq('slug', 'daily').single())
    tier[TEST_TENANT] = mustSucceed('vitest-b daily tier', await admin.from('membership_tiers').insert({
      slug: 'daily', name: 'Vitest B Daily', price_cents: B_DAILY_PRICE,
      duration_days: B_DAILY_DAYS, tenant: TEST_TENANT,
    }).select('id, price_cents').single())

    const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
    for (const tenant of ['224clubhouse', TEST_TENANT]) {
      event[tenant] = mustSucceed(`event ${tenant}`, await admin.from('events').insert({
        title: testEventTitle(`tmem-${tenant}`), date: future, capacity: 10, tenant,
      }).select('id').single()).id
    }

    u.cust224 = await createTenantUser(admin, 'tmem-cust224', '224clubhouse')
    u.custB = await createTenantUser(admin, 'tmem-custb', TEST_TENANT)
    u.dob224 = await createTenantUser(admin, 'tmem-dob224', '224clubhouse')
    u.dobB = await createTenantUser(admin, 'tmem-dobb', TEST_TENANT)
    u.admin224 = await createTenantUser(admin, 'tmem-admin224', '224clubhouse')
    u.adminB = await createTenantUser(admin, 'tmem-adminb', TEST_TENANT)
    // set_date_of_birth needs accounts with no date of birth on record yet.
    mustSucceed('clear dob profiles', await admin.from('customer_profiles')
      .delete().in('user_id', [u.dob224.id, u.dobB.id]))

    mustSucceed('admin 224', await admin.from('admin_users')
      .insert({ id: u.admin224.id, email: u.admin224.email, tenant: '224clubhouse' }))
    mustSucceed('admin b', await admin.from('admin_users')
      .insert({ id: u.adminB.id, email: u.adminB.email, tenant: TEST_TENANT }))

    alerts224 = mustSucceed('read 224 alerts', await admin.from('alert_settings')
      .select('telegram_chat_id, telegram_chat_title, telegram_enabled, telegram_kinds')
      .eq('tenant', '224clubhouse').single())

    for (const label of Object.keys(u)) {
      c[label] = await signInClient(u[label].email, TEST_PASSWORD)
    }
  })

  afterAll(async () => {
    if (!admin) return
    await admin.from('alert_settings').delete().eq('tenant', TEST_TENANT)
    const emails = [...Object.values(u).map((x) => x.email), CREATED_EMAIL_224, CREATED_EMAIL_B]
    await admin.from('memberships').delete().in('email', emails)
    await admin.from('event_reservations').delete().in('event_id', Object.values(event))
    await admin.from('events').delete().in('id', Object.values(event))
    await dropBDailyTier()
    await admin.from('newsletter_subscribers').delete().eq('email', NEWS_EMAIL)
    await admin.from('site_events').delete().in('path', [PATH_224, PATH_B])
    // Cascades to customer_profiles, customer_email_prefs, admin_users and drivers.
    await deleteTestUsers(admin, ...Object.values(u).map((x) => x.id))
  })

  const membershipsOf = async (email) => {
    const { data, error } = await admin.from('memberships')
      .select('id, tenant, tier_id, amount, consents, status').eq('email', email)
    expect(error).toBeNull()
    return data ?? []
  }

  it('a vitest-b "daily" tier coexists with 224\'s; place_membership charges each store\'s own price (age_min consent accepted)', async () => {
    expect(tier[TEST_TENANT].id).not.toBe(tier['224clubhouse'].id)

    const b = await c.custB.rpc('place_membership', application('1990-01-01', CONSENTS_MIN))
    expect(b.error).toBeNull()
    expect(b.data).toMatchObject({ tier: 'daily', amount: B_DAILY_PRICE, status: 'pending' })
    const [rowB] = await membershipsOf(u.custB.email)
    expect(rowB).toMatchObject({ tenant: TEST_TENANT, tier_id: tier[TEST_TENANT].id, amount: B_DAILY_PRICE })
    expect(rowB.consents).toMatchObject(CONSENTS_MIN)
    state.membershipB = rowB.id

    const own = await c.cust224.rpc('place_membership', application('1990-01-01'))
    expect(own.error).toBeNull()
    expect(own.data).toMatchObject({ tier: 'daily', amount: tier['224clubhouse'].price_cents })
    const [row224] = await membershipsOf(u.cust224.email)
    expect(row224).toMatchObject({ tenant: '224clubhouse', tier_id: tier['224clubhouse'].id })
    expect(row224.consents).toMatchObject(CONSENTS_21)
    expect(row224.consents).not.toHaveProperty('age_min')
  })

  it('membership age: 224 keeps its exact "Must be 21 or older"; vitest-b refuses under 18 and admits 19', async () => {
    const own = await c.dob224.rpc('place_membership', application(yearsAgoIso(19)))
    expect(own.data).toBeNull()
    expect(own.error?.message).toBe(MEMBERSHIP_AGE_224)

    const young = await c.dobB.rpc('place_membership', application(yearsAgoIso(17), CONSENTS_MIN))
    expect(young.error?.message).toBe('Must be 18 or older')

    const created224 = await c.admin224.rpc('admin_create_membership', {
      p_customer: { full_name: 'Vitest Walk-in', email: CREATED_EMAIL_224, phone: '0000000000', date_of_birth: yearsAgoIso(19) },
      p_tier_slug: 'daily',
    })
    expect(created224.error?.message).toBe(MEMBERSHIP_AGE_224)

    const createdB = await c.adminB.rpc('admin_create_membership', {
      p_customer: { full_name: 'Vitest Walk-in', email: CREATED_EMAIL_B, phone: '0000000000', date_of_birth: yearsAgoIso(19) },
      p_tier_slug: 'daily',
    })
    expect(createdB.error).toBeNull()
    expect(createdB.data).toMatchObject({ tier: 'daily', amount: B_DAILY_PRICE, status: 'active' })
    const [rowB] = await membershipsOf(CREATED_EMAIL_B)
    expect(rowB).toMatchObject({ tenant: TEST_TENANT, tier_id: tier[TEST_TENANT].id })
    state.createdB = rowB.id
  })

  it('set_date_of_birth 19 years ago: accepted in vitest-b, refused in 224 with 224\'s exact message (Review Focus 5)', async () => {
    const dob = yearsAgoIso(19)
    const b = await c.dobB.rpc('set_date_of_birth', { p_dob: dob })
    expect(b.error).toBeNull()
    expect(b.data).toEqual({ verified: true })
    expect((await c.dobB.rpc('my_age_verified')).data).toBe(true)
    const { data: prof } = await admin.from('customer_profiles').select('tenant').eq('user_id', u.dobB.id).single()
    expect(prof.tenant).toBe(TEST_TENANT)

    const own = await c.dob224.rpc('set_date_of_birth', { p_dob: dob })
    expect(own.error?.message).toBe(DOB_AGE_224)
    expect(own.error?.message).toMatch(/21 or older/)
    expect((await c.dob224.rpc('my_age_verified')).data).toBe(false)
  })

  it('NEGATIVE: admins cannot touch another store\'s membership (not found), nor link one to another store\'s account', async () => {
    const status = await c.admin224.rpc('admin_update_membership_status', { p_id: state.membershipB, p_status: 'active' })
    expect(status.error?.message).toBe('Membership not found')
    const { data: row } = await admin.from('memberships').select('status').eq('id', state.membershipB).single()
    expect(row.status).toBe('pending')

    const link = await c.adminB.rpc('admin_link_membership_user', {
      p_membership_id: state.createdB, p_email: u.cust224.email,
    })
    expect(link.error?.message).toMatch(/^No account found for /)
    const { data: linked } = await admin.from('memberships').select('user_id').eq('id', state.createdB).single()
    expect(linked.user_id).toBeNull()
  })

  it('admin_get_alert_settings: 224\'s admin gets 224\'s settings; vitest-b\'s admin gets the defaults, never 224\'s chat', async () => {
    const own = await c.admin224.rpc('admin_get_alert_settings')
    expect(own.error).toBeNull()
    expect(own.data).toMatchObject({
      chat_id: alerts224.telegram_chat_id,
      chat_title: alerts224.telegram_chat_title,
      enabled: alerts224.telegram_enabled,
      kinds: alerts224.telegram_kinds,
    })

    const b = await c.adminB.rpc('admin_get_alert_settings')
    expect(b.error).toBeNull()
    expect(b.data).toEqual({ has_token: false, chat_id: null, chat_title: null, enabled: false, kinds: {} })
  })

  it('admin_update_alert_settings by vitest-b\'s admin writes only vitest-b\'s settings', async () => {
    const before = mustSucceed('224 alerts', await admin.from('alert_settings')
      .select('telegram_enabled, telegram_kinds').eq('tenant', '224clubhouse').single())
    const res = await c.adminB.rpc('admin_update_alert_settings', { p_enabled: true, p_kinds: { order: false } })
    expect(res.error).toBeNull()

    const b = await c.adminB.rpc('admin_get_alert_settings')
    expect(b.data).toMatchObject({ chat_id: null, enabled: true, kinds: { order: false } })
    const after = mustSucceed('224 alerts', await admin.from('alert_settings')
      .select('telegram_enabled, telegram_kinds').eq('tenant', '224clubhouse').single())
    expect(after).toEqual(before)
  })

  it('Telegram server RPCs follow the store: set_telegram_chat / telegram_config per tenant; 224 keeps its vault name', async () => {
    expect((await admin.rpc('telegram_secret_name', { p_slug: '224clubhouse' })).data).toBe('telegram_bot_token')
    expect((await admin.rpc('telegram_secret_name', { p_slug: TEST_TENANT })).data)
      .toBe(`telegram_bot_token__${TEST_TENANT}`)
    expect((await anonClient().rpc('telegram_secret_name', { p_slug: '224clubhouse' })).error).not.toBeNull()

    const set = await serviceB.rpc('set_telegram_chat', { p_chat_id: 42, p_title: 'Vitest B group' })
    expect(set.error).toBeNull()
    const cfgB = await serviceB.rpc('telegram_config')
    expect(cfgB.error).toBeNull()
    expect(cfgB.data).toMatchObject({ token: null, chat_id: 42, enabled: true })

    // No header: exactly what 224's Edge Functions send today.
    const cfg224 = await admin.rpc('telegram_config')
    expect(cfg224.error).toBeNull()
    // vitest-b's set_telegram_chat above left 224's chat exactly as found.
    expect(cfg224.data).toMatchObject({
      chat_id: alerts224.telegram_chat_id,
      enabled: alerts224.telegram_enabled,
      kinds: alerts224.telegram_kinds,
    })
  })

  it('site_analytics and admin_daily_summary count only the caller\'s store (one track_event per tenant)', async () => {
    const visit = () => ({ p_visitor: randomUUID(), p_session: randomUUID(), p_event: 'page_view' })
    expect((await anonClient().rpc('track_event', { ...visit(), p_path: PATH_224 })).error).toBeNull()
    expect((await tenantClient(TEST_TENANT).rpc('track_event', { ...visit(), p_path: PATH_B })).error).toBeNull()
    const { data: stamped } = await admin.from('site_events').select('path, tenant').in('path', [PATH_224, PATH_B])
    expect(Object.fromEntries((stamped ?? []).map((r) => [r.path, r.tenant])))
      .toEqual({ [PATH_224]: '224clubhouse', [PATH_B]: TEST_TENANT })

    const b = await c.adminB.rpc('site_analytics', { p_days: 1 })
    expect(b.error).toBeNull()
    const pathsB = b.data.top_pages.map((t) => t.path)
    expect(pathsB).toContain(PATH_B)
    expect(pathsB).not.toContain(PATH_224)

    // admin_daily_summary defaults to today in Africa/Johannesburg (UTC+2, no DST).
    const sastDay = new Date(Date.now() + 2 * 3600000).toISOString().slice(0, 10)
    const { count: bViews } = await admin.from('site_events').select('id', { count: 'exact', head: true })
      .eq('tenant', TEST_TENANT).eq('event', 'page_view').gte('created_at', `${sastDay}T00:00:00+02:00`)
    const summaryB = await c.adminB.rpc('admin_daily_summary', { p_day: null })
    expect(summaryB.error).toBeNull()
    expect(summaryB.data.page_views).toBe(bViews)
    const summary224 = await c.admin224.rpc('admin_daily_summary', { p_day: null })
    expect(summary224.error).toBeNull()
    expect(summary224.data.page_views).toBeGreaterThanOrEqual(1)
  })

  it('NEGATIVE: reserve_event_seats by a vitest-b customer on a 224 event is "Event not found"; its own event works', async () => {
    const guest = { name: 'Vitest B', phone: '0000000000' }
    const cross = await c.custB.rpc('reserve_event_seats', {
      p_event_id: event['224clubhouse'], p_quantity: 1, p_customer: guest,
    })
    expect(cross.data).toBeNull()
    expect(cross.error?.message).toBe('Event not found')
    const { data: none } = await admin.from('event_reservations').select('id').eq('user_id', u.custB.id)
    expect(none).toEqual([])

    const own = await c.custB.rpc('reserve_event_seats', {
      p_event_id: event[TEST_TENANT], p_quantity: 2, p_customer: guest,
    })
    expect(own.error).toBeNull()
    const { data: rows } = await admin.from('event_reservations').select('id, tenant').eq('user_id', u.custB.id)
    expect(rows.map((r) => r.tenant)).toEqual([TEST_TENANT])
    state.reservationB = rows[0].id

    const { data: ev } = await tenantClient(TEST_TENANT).from('events')
      .select('id, seats_remaining:event_seats_remaining').eq('id', event[TEST_TENANT]).single()
    expect(ev.seats_remaining).toBe(8)

    const status = await c.admin224.rpc('admin_update_reservation_status', { p_id: state.reservationB, p_status: 'cancelled' })
    expect(status.error?.message).toBe('Reservation not found')
    const { data: res } = await admin.from('event_reservations').select('status').eq('id', state.reservationB).single()
    expect(res.status).toBe('reserved')
  })

  it('NEGATIVE: newsletter unsubscribe and cart opt-out tokens only work in their own store', async () => {
    expect((await tenantClient(TEST_TENANT).rpc('subscribe_newsletter', { p_email: NEWS_EMAIL })).error).toBeNull()
    const { data: sub } = await admin.from('newsletter_subscribers').select('unsubscribe_token')
      .eq('email', NEWS_EMAIL).eq('tenant', TEST_TENANT).single()
    const from224 = await anonClient().rpc('unsubscribe_newsletter', { p_token: sub.unsubscribe_token })
    expect(from224.data).toEqual({ success: false, reason: 'not_found' })
    const fromB = await tenantClient(TEST_TENANT).rpc('unsubscribe_newsletter', { p_token: sub.unsubscribe_token })
    expect(fromB.data).toEqual({ success: true, email: NEWS_EMAIL })

    const prefs = mustSucceed('prefs b', await admin.from('customer_email_prefs')
      .insert({ user_id: u.custB.id, tenant: TEST_TENANT }).select('token').single())
    expect((await anonClient().rpc('stop_cart_reminders', { p_token: prefs.token })).data).toBe(false)
    expect((await tenantClient(TEST_TENANT).rpc('stop_cart_reminders', { p_token: prefs.token })).data).toBe(true)
  })

  it('profile_from_signup: a 224 signup (no tenant claim) keeps the 21+ rule and its profile is stamped 224clubhouse', async () => {
    // The admin API inserts the auth.users row with app_metadata
    // {provider, providers} only and adds a custom claim afterwards, so the
    // trigger can only see a store's claim once the task-8 BEFORE INSERT stamp
    // exists (task 8's own signup test covers that path). Here: 224, unchanged.
    const signup = async (label, dob) => {
      const res = await admin.auth.admin.createUser({
        email: testEmail(label), password: TEST_PASSWORD, email_confirm: true,
        user_metadata: { date_of_birth: dob },
      })
      const user = mustSucceed(`signup ${label}`, res).user
      u[label] = { id: user.id, email: user.email }
      const { data } = await admin.from('customer_profiles')
        .select('tenant, date_of_birth').eq('user_id', user.id)
      return data ?? []
    }
    expect(await signup('tmem-signup-young', yearsAgoIso(19))).toEqual([])
    expect(await signup('tmem-signup-adult', '1990-01-01'))
      .toEqual([{ tenant: '224clubhouse', date_of_birth: '1990-01-01' }])
  })

  it('NEGATIVE: a claim naming a store with no tenants row fails closed in every age RPC ("Unknown store") (Ruling 8)', async () => {
    u.ghost = await createTestUser(admin, 'tmem-ghost')
    mustSucceed('ghost claim', await admin.auth.admin
      .updateUserById(u.ghost.id, { app_metadata: { tenant: 'no-such-store' } }))
    mustSucceed('clear ghost profile', await admin.from('customer_profiles').delete().eq('user_id', u.ghost.id))
    const ghost = await signInClient(u.ghost.email, TEST_PASSWORD)

    const dob = await ghost.rpc('set_date_of_birth', { p_dob: '1990-01-01' })
    expect(dob.error?.message).toBe('Unknown store')
    const { data: prof } = await admin.from('customer_profiles').select('user_id').eq('user_id', u.ghost.id)
    expect(prof).toEqual([])

    expect((await ghost.rpc('my_age_verified')).error?.message).toBe('Unknown store')

    const mem = await ghost.rpc('place_membership', application('1990-01-01'))
    expect(mem.error?.message).toBe('Unknown store')
    expect(await membershipsOf(u.ghost.email)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Task 8 — signup tenant stamp
//
// 20261102160000_tenant_signup_stamp adds a BEFORE INSERT trigger on
// auth.users (stamp_user_tenant) that writes app_metadata.tenant on every new
// account, so every JWT carries the claim current_tenant() trusts. The store
// comes from, in order: an app_metadata.tenant already on the row, the
// user_metadata.tenant a signup sends (public signUp options.data, or admin
// createUser user_metadata), then default_tenant(). A tenant with no tenants
// row is refused, so the account is not created. Nothing re-stamps on UPDATE:
// a user editing their own user_metadata.tenant later moves nothing.
//
// The public-signUp block runs ONLY on the local stack (scripts/test-local.mjs
// sets SUPABASE_LOCAL_STACK=1). Locally enable_confirmations is false, so
// signUp returns a session straight away. On production confirmation is on:
// signUp returns no session (the tests could not pass) and GoTrue would email a
// confirmation link to every vitest+…@example.com address. The admin-API block
// sends no mail (email_confirm: true) and runs everywhere.
// ---------------------------------------------------------------------------
const LOCAL_STACK = Boolean(process.env.SUPABASE_LOCAL_STACK)
const LOCAL_ONLY_REASON =
  'local stack only: needs enable_confirmations=false, and on production a public signUp would email a confirmation'

const stampReaders = (admin) => ({
  claimOf: async (id) => {
    const { data, error } = await admin.auth.admin.getUserById(id)
    expect(error).toBeNull()
    return data.user.app_metadata?.tenant
  },
  profileOf: async (id) => {
    const { data, error } = await admin.from('customer_profiles')
      .select('tenant, date_of_birth').eq('user_id', id)
    expect(error).toBeNull()
    return data
  },
})

describe.skipIf(CORE_SKIP || LOCAL_STACK)(`Tenancy contract — signup tenant stamp (public signUp) skipped (${LOCAL_ONLY_REASON})`, () => {
  it('reminds devs why the public-signUp block did not run', () => {})
})

describe.skipIf(CORE_SKIP || !LOCAL_STACK)(`Tenancy contract — signup tenant stamp (public signUp; ${LOCAL_ONLY_REASON})`, () => {
  const admin = CORE_SKIP || !LOCAL_STACK ? null : serviceClient()
  const ids = []
  const { claimOf, profileOf } = admin ? stampReaders(admin) : {}
  // Public signup, as the storefront does it. Never retried: a signup is a
  // write, and GoTrue reports the trigger's refusal as a 500.
  const signUp = async (label, data) => {
    const client = anonClient()
    const result = await client.auth.signUp({
      email: testEmail(label),
      password: TEST_PASSWORD,
      ...(data ? { options: { data } } : {}),
    })
    if (result.data?.user?.id) ids.push(result.data.user.id)
    return { client, result }
  }

  beforeAll(async () => {
    await ensureTestTenant(admin)
  })

  afterAll(async () => {
    if (!admin) return
    await deleteTestUsers(admin, ...ids)
  })

  it('a public signup with tenant vitest-b gets app_metadata.tenant vitest-b, and its JWT resolves to vitest-b', async () => {
    const { client, result } = await signUp('tstamp-b', { tenant: TEST_TENANT })
    const user = mustSucceed('signup vitest-b', result).user
    // Read back from the database: proves GoTrue's own post-insert writes do
    // not overwrite the BEFORE-trigger stamp (spec §5.3).
    expect(await claimOf(user.id)).toBe(TEST_TENANT)
    expect((await jwtPayload(client)).app_metadata?.tenant).toBe(TEST_TENANT)
    const { data, error } = await client.rpc('current_tenant')
    expect(error).toBeNull()
    expect(data).toBe(TEST_TENANT)
  })

  it('a public signup with no tenant gets 224clubhouse (as today)', async () => {
    const { client, result } = await signUp('tstamp-none')
    const user = mustSucceed('signup no tenant', result).user
    expect(await claimOf(user.id)).toBe('224clubhouse')
    expect((await jwtPayload(client)).app_metadata?.tenant).toBe('224clubhouse')
  })

  it('a public signup with an empty tenant gets 224clubhouse', async () => {
    const { result } = await signUp('tstamp-empty', { tenant: '' })
    const user = mustSucceed('signup empty tenant', result).user
    expect(await claimOf(user.id)).toBe('224clubhouse')
  })

  it('NEGATIVE: a public signup naming an unknown tenant is refused and no account is created', async () => {
    const { result } = await signUp('tstamp-nope', { tenant: 'nope' })
    expect(result.error).not.toBeNull()
    expect(result.data?.user ?? null).toBeNull()
    expect(await findUserIdByEmail(admin, testEmail('tstamp-nope'))).toBeNull()
  })

  it('a vitest-b signup with a date of birth 19 years ago gets a vitest-b profile (min age 18)', async () => {
    const dob = yearsAgoIso(19)
    const { result } = await signUp('tstamp-b-dob', { tenant: TEST_TENANT, date_of_birth: dob })
    const user = mustSucceed('signup vitest-b dob', result).user
    expect(await claimOf(user.id)).toBe(TEST_TENANT)
    expect(await profileOf(user.id)).toEqual([{ tenant: TEST_TENANT, date_of_birth: dob }])
  })

  it('NEGATIVE: a user changing their own user_metadata.tenant does not move their store', async () => {
    const { client, result } = await signUp('tstamp-move', { tenant: TEST_TENANT })
    const user = mustSucceed('signup move', result).user
    mustSucceed('edit own user_metadata', await client.auth.updateUser({ data: { tenant: '224clubhouse' } }))
    expect(await claimOf(user.id)).toBe(TEST_TENANT)
    mustSucceed('refresh session', await client.auth.refreshSession())
    const { data, error } = await client.rpc('current_tenant')
    expect(error).toBeNull()
    expect(data).toBe(TEST_TENANT)
  })
})

describe.skipIf(CORE_SKIP)('Tenancy contract — signup tenant stamp (admin API)', () => {
  const admin = CORE_SKIP ? null : serviceClient()
  const ids = []
  const { claimOf, profileOf } = admin ? stampReaders(admin) : {}

  beforeAll(async () => {
    await ensureTestTenant(admin)
  })

  afterAll(async () => {
    if (!admin) return
    await deleteTestUsers(admin, ...ids)
  })

  it('an admin-API createUser with user_metadata.tenant vitest-b gets the vitest-b claim and a vitest-b profile', async () => {
    // GoTrue's admin create inserts the row WITHOUT the custom app_metadata
    // (it arrives in a later UPDATE), so user_metadata is how the store
    // reaches the INSERT triggers on this path (Ruling 15).
    const dob = yearsAgoIso(19)
    const res = await admin.auth.admin.createUser({
      email: testEmail('tstamp-admin-b'), password: TEST_PASSWORD, email_confirm: true,
      user_metadata: { tenant: TEST_TENANT, date_of_birth: dob },
    })
    const user = mustSucceed('admin create vitest-b', res).user
    ids.push(user.id)
    expect(await claimOf(user.id)).toBe(TEST_TENANT)
    expect(await profileOf(user.id)).toEqual([{ tenant: TEST_TENANT, date_of_birth: dob }])
  })
})
