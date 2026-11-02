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
import { createClient } from '@supabase/supabase-js'
import {
  KEYS_MISSING, anonClient, serviceClient, testSlug, createTestUser,
  signInAs, deleteTestUsers, mustSucceed,
  probeMigration, describeGate, ensureTestTenant, tenantClient,
  createTenantUser, signInClient, TEST_TENANT, TEST_PASSWORD, testCode, testEmail,
  URL, SERVICE, liveClientOptions,
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
  let plainUserId = null
  let plainUserEmail = null

  beforeAll(async () => {
    await ensureTestTenant(admin)
    // No app_metadata.tenant: stands in for every pre-backfill 224 account.
    const plain = await createTestUser(admin, 'tenancy-core-plain')
    plainUserId = plain.id
    plainUserEmail = plain.email
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

  it('every existing row belongs to the default tenant (no NULL, no other tenant)', async () => {
    for (const table of TENANT_TABLES) {
      // Rows other suites park under vitest-b are removed by their owners; any
      // OTHER non-224 value (or NULL) means the backfill went wrong.
      const { data, error } = await admin.from(table).select('tenant').neq('tenant', '224clubhouse').limit(50)
      expect(error, table).toBeNull()
      const stray = (data ?? []).filter((r) => r.tenant !== TEST_TENANT)
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
// explicit tenant. The admin_users insert trigger (admin_becomes_driver) still
// stamps its drivers row with the default tenant until Task 6, so setup moves
// that row to the admin's tenant by hand.
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

  const makeAdmin = async (user, tenant) => {
    mustSucceed(`grant admin ${user.email}`, await admin.from('admin_users')
      .insert({ id: user.id, email: user.email, tenant }))
    mustSucceed(`driver tenant ${user.email}`, await admin.from('drivers')
      .update({ tenant }).eq('user_id', user.id))
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
})
