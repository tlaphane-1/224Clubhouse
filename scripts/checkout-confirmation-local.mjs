/**
 * Regression check: after Place Order, a phone-size browser must end on
 * /order-confirmation/<number>, not /cart (OPEN_ITEMS 3.3, 2026-11-03).
 *
 *   SUPABASE_BIN=<working supabase CLI> node scripts/checkout-confirmation-local.mjs
 *
 * Runs against the LOCAL Supabase stack only (refuses any other API host):
 * creates a confirmed adult customer and one in-stock product, starts the Vite
 * dev server pointed at the local stack (Firebase and Maps disabled so nothing
 * reaches production), places an order in Chromium at 390x844, then checks
 * where the browser ended up. Exit 0 = pass, 1 = fail, 2 = setup problem.
 */
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 5199
const SUPABASE_BIN = process.env.SUPABASE_BIN || 'supabase'
const DB_CONTAINER = 'supabase_db_224clubhouse'

function fail(message) {
  console.error(`checkout-confirmation-local: ${message}`)
  process.exit(2)
}

const status = spawnSync(SUPABASE_BIN, ['status', '-o', 'json'], { cwd: ROOT, encoding: 'utf8' })
if (status.error || status.status !== 0) fail('the local Supabase stack is not running.')
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

const email = `checkout-${randomUUID().slice(0, 8)}@example.test`
const password = `Local-${randomUUID()}`
const created = await fetch(`${local.API_URL}/auth/v1/admin/users`, {
  method: 'POST',
  headers: {
    apikey: local.SERVICE_ROLE_KEY,
    Authorization: `Bearer ${local.SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ email, password, email_confirm: true }),
}).then(r => r.json())
if (!created.id) fail(`createUser: ${JSON.stringify(created)}`)
psql(`insert into customer_profiles (user_id, date_of_birth) values ('${created.id}', '1990-01-01')
      on conflict (user_id) do update set date_of_birth = excluded.date_of_birth`)
const productId = randomUUID()
psql(`insert into products (id, name, price, category, stock_quantity, slug)
      values ('${productId}', 'Checkout Check', 6000, 'accessories', 50, 'checkout-check-${productId.slice(0, 8)}')`)

const vite = spawn(process.execPath, [resolve(ROOT, 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort'], {
  cwd: ROOT,
  env: {
    ...process.env,
    VITE_SUPABASE_URL: local.API_URL,
    VITE_SUPABASE_ANON_KEY: local.ANON_KEY,
    VITE_FIREBASE_DATABASE_URL: '',
    VITE_GOOGLE_MAPS_KEY: '',
  },
})
await new Promise((ok) => vite.stdout.on('data', (d) => { if (String(d).includes(String(PORT))) ok() }))

let exitCode = 1
const browser = await chromium.launch()
try {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  const base = `http://localhost:${PORT}`
  await page.goto(`${base}/`)
  await page.evaluate((item) => {
    localStorage.setItem('age-verified', 'true')
    localStorage.setItem('224-cart', JSON.stringify([item]))
  }, { id: productId, name: 'Checkout Check', price: 6000, quantity: 1, stock_quantity: 50, images: [], category: 'accessories', slug: 'checkout-check' })
  await page.goto(`${base}/checkout`)
  await page.fill('#auth-email', email)
  await page.fill('#auth-password', password)
  await page.click('button[type=submit]')
  await page.waitForSelector('#checkout-name', { timeout: 20_000 })
  const fields = { name: 'Checkout Check', phone: '0821234567', street: '1 Test St', city: 'Boksburg', postalCode: '1459' }
  for (const [key, value] of Object.entries(fields)) await page.fill(`#checkout-${key}`, value)
  const province = page.locator('#checkout-province')
  if (await province.evaluate(el => el.tagName) === 'SELECT') await province.selectOption({ index: 1 })
  else await province.fill('Gauteng')
  await page.click('label[for=checkout-agree]')

  const visited = []
  page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) visited.push(new URL(frame.url()).pathname) })
  await page.getByRole('button', { name: /Place Order/ }).click()
  await page.waitForURL(/\/order-confirmation\//, { timeout: 15_000 })
  await page.getByRole('heading', { name: 'Order Confirmed!' }).waitFor({ timeout: 15_000 })
  // Give a stray redirect time to fire before judging the final page.
  await page.waitForTimeout(2_000)
  const finalPath = new URL(page.url()).pathname
  const orders = psql(`select order_number from orders where user_id = '${created.id}'`)
  console.log(`visited: ${visited.join(' -> ')}`)
  console.log(`order in DB: ${orders || '(none)'}`)
  if (finalPath.startsWith('/order-confirmation/') && orders) {
    console.log('PASS: ended on the confirmation page')
    exitCode = 0
  } else {
    console.log(`FAIL: ended on ${finalPath}`)
  }
} catch (err) {
  console.log(`FAIL: ${err.message.split('\n')[0]}`)
} finally {
  await browser.close()
  vite.kill()
}
process.exit(exitCode)
