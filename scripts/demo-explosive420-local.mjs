/**
 * LOCAL-ONLY pitch demo of the second store, Explosive 420 (TENANT=explosive420).
 *
 *   SUPABASE_BIN=<working supabase CLI> node scripts/demo-explosive420-local.mjs          # seed only
 *   SUPABASE_BIN=<working supabase CLI> node scripts/demo-explosive420-local.mjs --serve  # seed + start dev server
 *   (npm run demo:e420 does the --serve form; set SUPABASE_BIN first if `supabase` on PATH is broken)
 *
 * Talks ONLY to the local Supabase stack (Docker): it refuses to run if
 * `supabase status` reports an API host other than 127.0.0.1/localhost, and it
 * never reads .env files. Idempotent — safe to re-run. It:
 *   1. upserts the `explosive420` tenants row (min age 21, order prefix E420);
 *   2. upserts the demo products and the alert_settings row for that store;
 *   3. creates the public `brand-assets` bucket if missing and uploads
 *      tenants/explosive420/assets/* under `e420/`;
 *   4. creates (or resets) a demo customer of that store: date of birth
 *      2000-01-01 (21+), email confirmed, any earlier orders
 *      cancelled so the first-order flow can be shown again.
 *      Email + password are written to scripts/demo-explosive420.local
 *      (gitignored by the *.local rule), created on the first run.
 *   5. with --serve: starts `vite` detached on http://localhost:5420
 *      (--strictPort) with TENANT=explosive420, Firebase and Maps disabled,
 *      and VITE_SUPABASE_URL=http://localhost:5420/sb, which
 *      scripts/vite.demo-local.config.mjs proxies to the local stack (the
 *      stack's self-signed https certificate would otherwise block Chrome).
 *      Its PID is printed and written to scripts/demo-explosive420-pid.local;
 *      stop it with `taskkill /PID <pid> /T /F`.
 */
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, openSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SLUG = 'explosive420'
const PORT = 5420
const SUPABASE_BIN = process.env.SUPABASE_BIN || 'supabase'
const DB_CONTAINER = 'supabase_db_224clubhouse'
const LOGIN_FILE = join(ROOT, 'scripts', 'demo-explosive420.local')
const PID_FILE = join(ROOT, 'scripts', 'demo-explosive420-pid.local')
const ASSETS = join(ROOT, 'tenants', SLUG, 'assets')

function fail(message) {
  console.error(`demo-explosive420-local: ${message}`)
  process.exit(2)
}

// ---- local stack only ------------------------------------------------------
const status = spawnSync(SUPABASE_BIN, ['status', '-o', 'json'], { cwd: ROOT, encoding: 'utf8' })
if (status.error || status.status !== 0) fail('the local Supabase stack is not running (or SUPABASE_BIN is wrong).')
const text = status.stdout
const local = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
if (!['127.0.0.1', 'localhost'].includes(new URL(local.API_URL).hostname)) {
  fail(`refusing non-local API host ${local.API_URL}`)
}
// The local stack serves https with a self-signed certificate.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const psql = (sql) => {
  const r = spawnSync('docker', ['exec', DB_CONTAINER, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tAc', sql], { encoding: 'utf8' })
  if (r.status !== 0) fail(`psql: ${r.stderr}`)
  return r.stdout.trim()
}
const q = (s) => `'${String(s).replace(/'/g, "''")}'`
const service = {
  apikey: local.SERVICE_ROLE_KEY,
  Authorization: `Bearer ${local.SERVICE_ROLE_KEY}`,
}

// ---- 1. tenant row ---------------------------------------------------------
psql(`insert into tenants (slug, name, order_prefix, min_age, active)
      values ('${SLUG}', 'Explosive 420 Cannabis Social Club', 'E420', 21, true)
      on conflict (slug) do update set name = excluded.name, order_prefix = excluded.order_prefix,
        min_age = excluded.min_age, active = true`)

// ---- 2. demo catalogue (prices are integer cents; ~R150/g per the owner) ---
const PRODUCTS = [
  ['Explosive OG', 'explosive-og', 'hybrid', 24, 15000, 'Heavy-hitting house hybrid with a classic earthy, piney OG nose.'],
  ['Soshanguve Haze', 'soshanguve-haze', 'sativa', 22, 15000, 'Bright, uplifting sativa with citrus and spice notes.'],
  ['Purple Grenade', 'purple-grenade', 'indica', 23, 16000, 'Deep purple indica for slow evenings; berry and grape aroma.'],
  ['Gelato Blast', 'gelato-blast', 'hybrid', 25, 18000, 'Creamy, sweet dessert hybrid. Smooth and balanced.'],
  ['Lemon Fuse', 'lemon-fuse', 'sativa', 21, 15000, 'Zesty lemon-forward sativa for a clear, social high.'],
  ['Northern Kush', 'northern-kush', 'indica', 20, 15000, 'Relaxing old-school kush with a hashy finish.'],
  ['Rasta Runtz', 'rasta-runtz', 'hybrid', 26, 20000, 'Top-shelf candy-sweet hybrid. Limited indoor batch.'],
]
const rows = PRODUCTS.map(([name, slug, strain, thc, price, desc]) =>
  `(${q(SLUG)}, ${q(name)}, ${q(slug)}, ${q(`${desc} Premium indoor flower from local growers. (Demo product.)`)}, ${price}, 'flower', ${q(strain)}, ${thc}, 1, 50, true)`)
rows.push(`(${q(SLUG)}, 'Explosive Pre-Roll', 'explosive-pre-roll', ${q('Single 1g pre-roll of the house Explosive OG. (Demo product.)')}, 6000, 'joints', 'hybrid', 24, 1, 80, true)`)
psql(`insert into products (tenant, name, slug, description, price, category, strain_type, thc_percentage, weight_grams, stock_quantity, is_available)
      values ${rows.join(',\n')}
      on conflict (tenant, slug) do update set name = excluded.name, description = excluded.description,
        price = excluded.price, category = excluded.category, strain_type = excluded.strain_type,
        thc_percentage = excluded.thc_percentage, weight_grams = excluded.weight_grams,
        stock_quantity = greatest(products.stock_quantity, 20), is_available = true`)
psql(`insert into alert_settings (tenant) values ('${SLUG}') on conflict (tenant) do nothing`)
// The membership page shows a load error with no tiers. One placeholder tier;
// the owner has not supplied membership prices.
psql(`insert into membership_tiers (tenant, slug, name, price_cents, duration_days, perks, sort_order, is_active)
      values ('${SLUG}', 'monthly', 'Monthly Member (demo price)', 10000, 30,
        '["Free delivery on every order for 30 days", "Keep ordering: no limit after your first order", "Price is a demo placeholder, to be confirmed"]'::jsonb, 1, true)
      on conflict (tenant, slug) do update set name = excluded.name, price_cents = excluded.price_cents,
        duration_days = excluded.duration_days, perks = excluded.perks, is_active = true`)

// ---- 3. brand images -------------------------------------------------------
const STORAGE = `${local.API_URL}/storage/v1`
const bucket = await fetch(`${STORAGE}/bucket/brand-assets`, { headers: service })
if (bucket.status !== 200) {
  const made = await fetch(`${STORAGE}/bucket`, {
    method: 'POST',
    headers: { ...service, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'brand-assets', name: 'brand-assets', public: true }),
  })
  if (!made.ok) fail(`create bucket: ${made.status} ${await made.text()}`)
}
const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }
for (const file of readdirSync(ASSETS)) {
  const type = TYPES[extname(file).toLowerCase()]
  if (!type) continue
  const up = await fetch(`${STORAGE}/object/brand-assets/e420/${file}`, {
    method: 'POST',
    headers: { ...service, 'Content-Type': type, 'x-upsert': 'true', 'Cache-Control': 'max-age=300' },
    body: readFileSync(join(ASSETS, file)),
  })
  if (!up.ok) fail(`upload ${file}: ${up.status} ${await up.text()}`)
}

// ---- 4. demo customer --------------------------------------------------------
let login
if (existsSync(LOGIN_FILE)) {
  login = Object.fromEntries(readFileSync(LOGIN_FILE, 'utf8').split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
} else {
  login = { email: 'demo.customer@explosive420.example', password: `E420-${randomBytes(6).toString('hex')}` }
  writeFileSync(LOGIN_FILE, `# Local demo customer for TENANT=explosive420 (local Supabase stack only)\nemail=${login.email}\npassword=${login.password}\n`)
}
let userId = psql(`select id from auth.users where email = ${q(login.email)}`)
if (!userId) {
  // user_metadata.tenant is what stamp_user_tenant reads at insert time; the
  // date_of_birth is copied into customer_profiles by profile_from_signup.
  const created = await fetch(`${local.API_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { ...service, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: login.email,
      password: login.password,
      email_confirm: true,
      user_metadata: { tenant: SLUG, date_of_birth: '2000-01-01' },
    }),
  }).then(r => r.json())
  if (!created.id) fail(`createUser: ${JSON.stringify(created)}`)
  userId = created.id
}
const stamped = psql(`select raw_app_meta_data->>'tenant' from auth.users where id = '${userId}'`)
if (stamped !== SLUG) fail(`demo customer belongs to "${stamped}", expected ${SLUG}`)
psql(`insert into customer_profiles (user_id, date_of_birth, tenant) values ('${userId}', '2000-01-01', '${SLUG}')
      on conflict (user_id) do update set date_of_birth = excluded.date_of_birth`)
// Membership is required from the second order on; cancelling earlier demo
// orders lets the first-order checkout be shown again on every run.
psql(`update orders set status = 'cancelled' where user_id = '${userId}' and status <> 'cancelled'`)

console.log(`seeded tenant ${SLUG}: ${psql(`select count(*) from products where tenant = '${SLUG}'`)} products; demo login in ${LOGIN_FILE}`)

// ---- 5. dev server -----------------------------------------------------------
if (process.argv.includes('--serve')) {
  const logFile = join(tmpdir(), 'demo-explosive420-vite.log')
  const out = openSync(logFile, 'a')
  const vite = spawn(process.execPath, [
    resolve(ROOT, 'node_modules/vite/bin/vite.js'),
    '--config', 'scripts/vite.demo-local.config.mjs',
    '--port', String(PORT), '--strictPort',
  ], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', out, out],
    windowsHide: true,
    env: {
      ...process.env,
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
      TENANT: SLUG,
      DEMO_LOCAL_API_URL: local.API_URL,
      VITE_SUPABASE_URL: `http://localhost:${PORT}/sb`,
      VITE_SUPABASE_ANON_KEY: local.ANON_KEY,
      // Process env beats .env.local in Vite: blank every other client var so
      // none of 224's live values (Firebase, Paystack, WhatsApp number, bank
      // details override) reach this store's demo.
      VITE_FIREBASE_API_KEY: '',
      VITE_FIREBASE_AUTH_DOMAIN: '',
      VITE_FIREBASE_DATABASE_URL: '',
      VITE_FIREBASE_PROJECT_ID: '',
      VITE_PAYSTACK_PUBLIC_KEY: '',
      VITE_WHATSAPP_NUMBER: '',
      VITE_EFT_BANK_DETAILS: '',
      VITE_GOOGLE_MAPS_KEY: '',
    },
  })
  vite.unref()
  writeFileSync(PID_FILE, `${vite.pid}\n`)
  console.log(`dev server starting: http://localhost:${PORT}  (pid ${vite.pid}, log ${logFile})`)
}
