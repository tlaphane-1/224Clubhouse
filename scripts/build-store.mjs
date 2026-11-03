/**
 * Builds one store other than 224 into its own folder, so 224's dist/ is never
 * touched:
 *
 *   node scripts/build-store.mjs explosive420     # → dist-explosive420/
 *   (npm run build:e420 runs exactly that)
 *
 * It runs the same two steps as `npm run build` (vite build, then the SEO
 * prerender) with TENANT=<slug>, and deploys from firebase.<slug>.json.
 * No new dependency: this replaces cross-env for setting env vars on Windows.
 *
 * .env.local is 224's file. The shared values (Supabase URL + anon key,
 * Firebase web config) are right for every store, but a few VITE_ vars are
 * 224's own business facts. They are blanked here — Vite lets process env beat
 * .env files — so they can never reach another store's bundle:
 *   VITE_WHATSAPP_NUMBER    224's WhatsApp order line
 *   VITE_EFT_BANK_DETAILS   224's bank account (the store's own comes from tenant.json bank)
 *   VITE_PAYSTACK_PUBLIC_KEY 224's Paystack account (would take payments into it)
 *   VITE_GOOGLE_MAPS_KEY    restricted to 224's hostnames; the map block is then omitted
 */
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_TENANT, loadTenant, resolveTenantSlug } from '../tenants/loadTenant.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const slug = resolveTenantSlug({ TENANT: process.argv[2] })
if (slug === DEFAULT_TENANT) {
  console.error(`build-store: ${DEFAULT_TENANT} builds with \`npm run build\` (into dist/), not this script.`)
  process.exit(2)
}
loadTenant(slug) // fail here, naming the problem, before anything is built

const outDir = `dist-${slug}`
const env = {
  ...process.env,
  TENANT: slug,
  VITE_WHATSAPP_NUMBER: '',
  VITE_EFT_BANK_DETAILS: '',
  VITE_PAYSTACK_PUBLIC_KEY: '',
  VITE_GOOGLE_MAPS_KEY: '',
}

function run(label, args) {
  console.log(`\n[build-store] ${label}`)
  const r = spawnSync(process.execPath, args, { cwd: ROOT, env, stdio: 'inherit' })
  if (r.status !== 0) {
    console.error(`[build-store] ${label} failed (exit ${r.status})`)
    process.exit(r.status ?? 1)
  }
}

run(`vite build (TENANT=${slug}) → ${outDir}/`,
  [resolve(ROOT, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', outDir, '--emptyOutDir'])
run(`prerender SEO pages into ${outDir}/`,
  [resolve(ROOT, 'scripts/prerender-seo.mjs'), '--dist', outDir])

console.log(`\n[build-store] done: ${outDir}/ (deploy with firebase deploy --config firebase.${slug}.json --only hosting)`)
