/**
 * Provisions the Explosive 420 store (tenant `explosive420`) in a Supabase
 * project that already has the phase-2 tenancy migrations. Idempotent: safe to
 * re-run. It touches ONLY Explosive 420 rows and storage objects under e420/.
 *
 *   node scripts/provision-explosive420.mjs --local                 # local Docker stack
 *   node scripts/provision-explosive420.mjs --production            # dry run: prints the plan
 *   node scripts/provision-explosive420.mjs --production --yes      # writes production
 *   ... --admin      also create the store's first admin (see ADMIN_EMAIL below)
 *   ... --remove     undo: delete what this script created (see removeAll)
 *
 * --local reads `supabase status` (SUPABASE_BIN overrides the CLI path) and
 * refuses any API host that is not 127.0.0.1/localhost.
 * --production reads VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY and
 * SUPABASE_SERVICE_ROLE_KEY from .env.local, refuses any host other than
 * 224's project (aogdkqczvlffgydgxsmz.supabase.co), and writes nothing without
 * --yes. No key or password is ever printed.
 *
 * Writes (all with tenant 'explosive420' set explicitly — the service role has
 * no JWT claim, so a column default would otherwise resolve to 224):
 *   tenants          the explosive420 row (name, order prefix E420, min age 21)
 *   alert_settings   the store's (empty) alert row
 *   products         the 8 catalogue products (new ones get stock 50; a re-run
 *                    updates names/prices/descriptions but never resets stock)
 *   membership_tiers one Monthly Membership tier (the membership page needs one)
 *   storage          tenants/explosive420/assets/* → brand-assets/e420/
 *   with --admin:    auth user ADMIN_EMAIL (email confirmed, tenant claim
 *                    explosive420) + its admin_users row; the generated
 *                    password is written to scripts/explosive420-admin.local
 *                    (gitignored), never printed.
 * Then it reads back with the anon key: with x-tenant: explosive420 it must see
 * the 8 products and the tier; with no header (224's view) it must see none.
 */
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SLUG = 'explosive420'
const PRODUCTION_HOST = 'aogdkqczvlffgydgxsmz.supabase.co'
const ASSETS = join(ROOT, 'tenants', SLUG, 'assets')
const BRAND_FOLDER = 'e420' // tenant.json images.* point at brand-assets/e420/…
const UPLOAD_FOLDER = 'e420' // tenant.json images.uploadFolder (admin uploads)
const ADMIN_EMAIL = 'tlaphane+explosive420@gmail.com'
const ADMIN_FILE = join(ROOT, 'scripts', 'explosive420-admin.local')

const TENANT_ROW = { slug: SLUG, name: 'Explosive 420 Cannabis Social Club', order_prefix: 'E420', min_age: 21, active: true }

// Prices are integer cents (around R150 per gram, per the owner). No THC
// figures: none were supplied, and an invented lab number would read as fact.
const flower = (name, slug, strain, price) => ({
  name, slug, price, category: 'flower', strain_type: strain, weight_grams: 1,
  description: `${strain[0].toUpperCase()}${strain.slice(1)} flower. Premium indoor, from local growers.`,
})
const PRODUCTS = [
  flower('Explosive OG', 'explosive-og', 'hybrid', 15000),
  flower('Soshanguve Haze', 'soshanguve-haze', 'sativa', 15000),
  flower('Purple Grenade', 'purple-grenade', 'indica', 16000),
  flower('Gelato Blast', 'gelato-blast', 'hybrid', 18000),
  flower('Lemon Fuse', 'lemon-fuse', 'sativa', 15000),
  flower('Northern Kush', 'northern-kush', 'indica', 15000),
  flower('Rasta Runtz', 'rasta-runtz', 'hybrid', 20000),
  { name: 'Explosive Pre-Roll', slug: 'explosive-pre-roll', price: 6000, category: 'joints', strain_type: 'hybrid',
    weight_grams: 1, description: 'Single 1g pre-roll. Premium indoor, from local growers.' },
].map(p => ({ ...p, thc_percentage: null, is_available: true, is_member_only: false }))
const NEW_PRODUCT_STOCK = 50

const TIER = {
  slug: 'monthly', name: 'Monthly Membership', price_cents: 10000, duration_days: 30, sort_order: 1, is_active: true,
  perks: ['30 days of membership', 'Access to members-only products', 'Keep ordering after your first order'],
}

const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }

// ---- arguments -------------------------------------------------------------
const args = new Set(process.argv.slice(2))
const known = ['--local', '--production', '--yes', '--admin', '--remove']
for (const a of args) if (!known.includes(a)) fail(`unknown option ${a} (use ${known.join(' ')})`)
if (args.has('--local') === args.has('--production')) fail('choose exactly one target: --local or --production')
const PRODUCTION = args.has('--production')
const WRITE = !PRODUCTION || args.has('--yes')

function fail(message) {
  console.error(`provision-explosive420: ${message}`)
  process.exit(2)
}

// ---- target ----------------------------------------------------------------
function localTarget() {
  const bin = process.env.SUPABASE_BIN || 'supabase'
  const r = spawnSync(bin, ['status', '-o', 'json'], { cwd: ROOT, encoding: 'utf8' })
  if (r.error || r.status !== 0) fail('the local Supabase stack is not running (or SUPABASE_BIN is wrong)')
  const s = JSON.parse(r.stdout.slice(r.stdout.indexOf('{'), r.stdout.lastIndexOf('}') + 1))
  if (!['127.0.0.1', 'localhost'].includes(new URL(s.API_URL).hostname)) fail(`refusing non-local API host ${s.API_URL}`)
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0' // the local stack's self-signed certificate
  return { url: s.API_URL, anon: s.ANON_KEY, service: s.SERVICE_ROLE_KEY, label: `LOCAL ${s.API_URL}` }
}

function productionTarget() {
  const file = join(ROOT, '.env.local')
  if (!existsSync(file)) fail('.env.local not found')
  const env = Object.fromEntries(readFileSync(file, 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))
  const url = env.VITE_SUPABASE_URL ?? ''
  let host = ''
  try { host = new URL(url).hostname } catch { /* reported below */ }
  if (host !== PRODUCTION_HOST) fail(`VITE_SUPABASE_URL host is "${host}", expected ${PRODUCTION_HOST}`)
  if (!env.SUPABASE_SERVICE_ROLE_KEY || !env.VITE_SUPABASE_ANON_KEY) fail('.env.local lacks SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_ANON_KEY')
  return { url, anon: env.VITE_SUPABASE_ANON_KEY, service: env.SUPABASE_SERVICE_ROLE_KEY, label: `PRODUCTION ${host}` }
}

const target = PRODUCTION ? productionTarget() : localTarget()
const clientOpts = headers => ({ auth: { autoRefreshToken: false, persistSession: false }, global: { headers } })
// x-tenant as well as the explicit column: belt and braces for any default.
const service = createClient(target.url, target.service, clientOpts({ 'x-tenant': SLUG }))
const anonFor = headers => createClient(target.url, target.anon, clientOpts(headers))

const check = (label, { error }) => { if (error) throw new Error(`${label}: ${error.message}`) }

// ---- plan ------------------------------------------------------------------
const assetFiles = readdirSync(ASSETS).filter(f => TYPES[extname(f).toLowerCase()])
console.log(`target: ${target.label}`)
if (args.has('--remove')) {
  console.log(`plan: REMOVE every ${SLUG} row this script creates (products + variants, tier, alert_settings, admin_users,`
    + ` ${args.has('--admin') ? `the auth user ${ADMIN_EMAIL}, ` : ''}storage under brand-assets/${BRAND_FOLDER}/,`
    + ` product-images/${UPLOAD_FOLDER}/, event-images/${UPLOAD_FOLDER}/), then the tenants row if nothing else references it.`)
} else {
  console.log(`plan: upsert tenants row ${SLUG} (order prefix ${TENANT_ROW.order_prefix}, min age ${TENANT_ROW.min_age}); alert_settings row;`
    + ` ${PRODUCTS.length} products; tier "${TIER.name}"; upload ${assetFiles.length} images to brand-assets/${BRAND_FOLDER}/`
    + `${args.has('--admin') ? `; admin ${ADMIN_EMAIL}` : ''}; then verify with the anon key.`)
}
if (!WRITE) {
  console.log('dry run: nothing written. Re-run with --yes to apply.')
  process.exit(0)
}

// ---- provision ---------------------------------------------------------------
async function provision() {
  check('tenants', await service.from('tenants').upsert(TENANT_ROW, { onConflict: 'slug' }))
  check('alert_settings', await service.from('alert_settings')
    .upsert({ tenant: SLUG }, { onConflict: 'tenant', ignoreDuplicates: true }))

  // A slug is unique per store, so sharing one with 224 is allowed; still
  // worth knowing, since the two stores' product URLs would then look alike.
  const { data: clash, error: clashErr } = await service.from('products').select('slug')
    .eq('tenant', '224clubhouse').in('slug', PRODUCTS.map(p => p.slug))
  check('slug check', { error: clashErr })
  if (clash.length) console.warn(`note: 224 also has slug(s) ${clash.map(r => r.slug).join(', ')} (allowed: slugs are per store)`)

  const { data: have, error: haveErr } = await service.from('products').select('slug').eq('tenant', SLUG)
  check('products read', { error: haveErr })
  const existing = new Set(have.map(r => r.slug))
  const fresh = PRODUCTS.filter(p => !existing.has(p.slug)).map(p => ({ ...p, tenant: SLUG, stock_quantity: NEW_PRODUCT_STOCK }))
  if (fresh.length) check('products insert', await service.from('products').insert(fresh))
  for (const p of PRODUCTS.filter(p => existing.has(p.slug))) {
    check(`products update ${p.slug}`, await service.from('products').update(p).eq('tenant', SLUG).eq('slug', p.slug))
  }

  check('membership_tiers', await service.from('membership_tiers')
    .upsert({ ...TIER, tenant: SLUG }, { onConflict: 'tenant,slug' }))

  const { error: bucketErr } = await service.storage.getBucket('brand-assets')
  if (bucketErr) {
    if (PRODUCTION) throw new Error(`brand-assets bucket: ${bucketErr.message}`)
    check('create brand-assets', await service.storage.createBucket('brand-assets', { public: true }))
  }
  for (const file of assetFiles) {
    check(`upload ${file}`, await service.storage.from('brand-assets').upload(`${BRAND_FOLDER}/${file}`,
      readFileSync(join(ASSETS, file)), { contentType: TYPES[extname(file).toLowerCase()], upsert: true, cacheControl: '300' }))
  }
  console.log(`wrote: tenants, alert_settings, ${fresh.length} new + ${PRODUCTS.length - fresh.length} updated products, tier, ${assetFiles.length} images`)

  if (args.has('--admin')) await provisionAdmin()
}

async function findUserByEmail(email) {
  for (let page = 1; ; page++) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw new Error(`listUsers: ${error.message}`)
    const hit = data.users.find(u => (u.email ?? '').toLowerCase() === email.toLowerCase())
    if (hit || data.users.length < 1000) return hit ?? null
  }
}

async function provisionAdmin() {
  let user = await findUserByEmail(ADMIN_EMAIL)
  if (user) {
    const claim = user.app_metadata?.tenant
    if (claim !== SLUG) throw new Error(`${ADMIN_EMAIL} already exists with store "${claim}", not ${SLUG}; refusing to make it an admin`)
    console.log(`admin: ${ADMIN_EMAIL} already exists (store ${SLUG}); password unchanged`)
  } else {
    // Never write a password to a file git would commit.
    const ignored = spawnSync('git', ['check-ignore', '-q', ADMIN_FILE], { cwd: ROOT })
    if (ignored.status !== 0) throw new Error(`${ADMIN_FILE} is not gitignored; refusing to write the password there`)
    const password = `E420-${randomBytes(18).toString('base64url')}`
    // Ruling 15: the signup stamp reads user_metadata.tenant at insert, and
    // GoTrue then REPLACES app_metadata with what is passed here, so both
    // must name the store or the account would lose its tenant claim.
    const { data, error } = await service.auth.admin.createUser({
      email: ADMIN_EMAIL, password, email_confirm: true,
      user_metadata: { tenant: SLUG }, app_metadata: { tenant: SLUG },
    })
    if (error) throw new Error(`createUser: ${error.message}`)
    user = data.user
    writeFileSync(ADMIN_FILE, `# ${SLUG} admin (${target.label}). Change the password after first sign-in.\nemail=${ADMIN_EMAIL}\npassword=${password}\n`)
    console.log(`admin: created ${ADMIN_EMAIL}; sign-in details written to ${ADMIN_FILE}`)
  }
  const { data: fresh, error: getErr } = await service.auth.admin.getUserById(user.id)
  if (getErr) throw new Error(`getUserById: ${getErr.message}`)
  if (fresh.user.app_metadata?.tenant !== SLUG) throw new Error(`${ADMIN_EMAIL} has tenant claim "${fresh.user.app_metadata?.tenant}", expected ${SLUG}`)

  check('admin_users', await service.from('admin_users')
    .upsert({ id: user.id, email: ADMIN_EMAIL, tenant: SLUG }, { onConflict: 'id', ignoreDuplicates: true }))
  const { data: row, error: rowErr } = await service.from('admin_users').select('tenant').eq('id', user.id).single()
  check('admin_users read', { error: rowErr })
  if (row.tenant !== SLUG) throw new Error(`admin_users row for ${ADMIN_EMAIL} has tenant "${row.tenant}", expected ${SLUG}`)
  console.log(`admin: admin_users row present for ${ADMIN_EMAIL} (tenant ${SLUG})`)
}

// ---- verify ------------------------------------------------------------------
async function verify() {
  const own = anonFor({ 'x-tenant': SLUG })
  const plain = anonFor({})
  const p = await own.from('products').select('slug, tenant').eq('is_available', true)
  check('verify products', p)
  const t = await own.from('membership_tiers').select('slug, tenant')
  check('verify tiers', t)
  const leak = await plain.from('products').select('slug').eq('tenant', SLUG)
  check('verify 224 view', leak)
  const ok = p.data.length >= PRODUCTS.length && p.data.every(r => r.tenant === SLUG)
    && t.data.some(r => r.slug === TIER.slug) && t.data.every(r => r.tenant === SLUG)
    && leak.data.length === 0
  console.log(`verify (anon, x-tenant ${SLUG}): ${p.data.length} products, ${t.data.length} tier(s), all tenant ${SLUG}`)
  console.log(`verify (anon, no header = 224's view): ${leak.data.length} ${SLUG} products visible (must be 0)`)
  if (!ok) throw new Error('verification FAILED')
  console.log('verify: PASS')
}

// ---- remove ------------------------------------------------------------------
async function removeObjects(bucket, prefix) {
  let removed = 0
  for (;;) {
    const { data, error } = await service.storage.from(bucket).list(prefix, { limit: 100 })
    if (error) {
      if (/not found/i.test(error.message)) return removed
      throw new Error(`list ${bucket}/${prefix}: ${error.message}`)
    }
    const files = data.filter(o => o.id).map(o => `${prefix}/${o.name}`)
    const folders = data.filter(o => !o.id).map(o => `${prefix}/${o.name}`)
    for (const f of folders) removed += await removeObjects(bucket, f)
    if (!files.length) return removed
    check(`remove ${bucket}/${prefix}`, await service.storage.from(bucket).remove(files))
    removed += files.length
  }
}

async function removeAll() {
  check('admin_users', await service.from('admin_users').delete().eq('tenant', SLUG))
  if (args.has('--admin')) {
    const user = await findUserByEmail(ADMIN_EMAIL)
    if (user && user.app_metadata?.tenant === SLUG) {
      const { error } = await service.auth.admin.deleteUser(user.id)
      if (error) throw new Error(`deleteUser: ${error.message}`)
      console.log(`removed auth user ${ADMIN_EMAIL}`)
    }
  }
  check('product_variants', await service.from('product_variants').delete().eq('tenant', SLUG))
  const products = await service.from('products').delete().eq('tenant', SLUG).select('id')
  if (products.error) {
    // Orders keep their items as JSON, but reviews reference products.
    throw new Error(`products: ${products.error.message} (delete this store's product_reviews first; see the runbook)`)
  }
  check('membership_tiers', await service.from('membership_tiers').delete().eq('tenant', SLUG))
  check('alert_settings', await service.from('alert_settings').delete().eq('tenant', SLUG))
  const objects = await removeObjects('brand-assets', BRAND_FOLDER)
    + await removeObjects('product-images', UPLOAD_FOLDER)
    + await removeObjects('event-images', UPLOAD_FOLDER)
  console.log(`removed ${products.data.length} products, the tier, alert_settings, admin rows, ${objects} storage objects`)

  // Anything customers created while the store was live (orders, members,
  // accounts…) still references the tenants row; list it instead of deleting it.
  const tables = ['orders', 'memberships', 'customer_profiles', 'event_reservations', 'events', 'product_reviews',
    'newsletter_subscribers', 'contact_messages', 'saved_carts', 'site_events', 'discount_codes', 'drivers',
    'customer_email_prefs', 'driver_locations']
  const left = []
  for (const table of tables) {
    const { count, error } = await service.from(table).select('*', { count: 'exact', head: true }).eq('tenant', SLUG)
    if (error) throw new Error(`count ${table}: ${error.message}`)
    if (count) left.push(`${table}=${count}`)
  }
  if (left.length) {
    console.log(`kept the tenants row: other ${SLUG} rows remain (${left.join(', ')}). See the runbook to clear them.`)
    return
  }
  const { error } = await service.from('tenants').delete().eq('slug', SLUG)
  if (error) {
    console.log(`kept the tenants row: ${error.message} (likely ${SLUG} auth accounts; see the runbook)`)
    return
  }
  console.log(`removed the tenants row ${SLUG}`)
}

try {
  if (args.has('--remove')) {
    await removeAll()
  } else {
    await provision()
    await verify()
  }
} catch (err) {
  console.error(`provision-explosive420: ${err.message}`)
  process.exit(1)
}
