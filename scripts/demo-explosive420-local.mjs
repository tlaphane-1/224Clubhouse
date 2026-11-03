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
 *   1-3. runs scripts/provision-explosive420.mjs --local (tenants row,
 *      alert_settings, products, membership tier, brand images under e420/) —
 *      the same script the owner runs against production;
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
import { existsSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SLUG = 'explosive420'
const PORT = 5420
const SUPABASE_BIN = process.env.SUPABASE_BIN || 'supabase'
const DB_CONTAINER = 'supabase_db_224clubhouse'
const LOGIN_FILE = join(ROOT, 'scripts', 'demo-explosive420.local')
const PID_FILE = join(ROOT, 'scripts', 'demo-explosive420-pid.local')

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

// ---- 1-3. store rows + brand images: the same script production uses -------
// (scripts/provision-explosive420.mjs), so local shows what production gets.
const provisioned = spawnSync(process.execPath, [join(ROOT, 'scripts', 'provision-explosive420.mjs'), '--local'], {
  cwd: ROOT, stdio: 'inherit', env: { ...process.env, SUPABASE_BIN },
})
if (provisioned.status !== 0) fail('provision-explosive420 --local failed')

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
