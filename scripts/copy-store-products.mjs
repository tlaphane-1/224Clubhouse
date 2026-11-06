/**
 * Copies one store's available products (with their options and pictures) into
 * another store on the same Supabase project.
 *
 *   node scripts/copy-store-products.mjs --from 224clubhouse --to explosive420             # dry run: lists what would be copied
 *   node scripts/copy-store-products.mjs --from 224clubhouse --to explosive420 --yes       # writes production
 *
 * Reads VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local and
 * refuses any host other than 224's project. Nothing in the source store is
 * changed. Per product:
 *   - skipped if the target store already has that slug (re-runs are safe);
 *   - pictures stored in our product-images bucket are copied into the target
 *     store's upload folder, so deleting one in either store never breaks the
 *     other; any other picture URL is kept as it is;
 *   - stock is NOT copied (it is the other shop's physical inventory): each
 *     product, or each of its options, starts at NEW_STOCK;
 *   - options (product_variants) are copied with label, price, order and
 *     availability; the variants trigger then derives the product's price.
 * Every row is written with the target tenant explicitly (and the x-tenant
 * header): the service role has no JWT claim, so a column default would
 * otherwise resolve to 224.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { loadTenant } from '../tenants/loadTenant.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PRODUCTION_HOST = 'aogdkqczvlffgydgxsmz.supabase.co'
const NEW_STOCK = 50

function fail(message) {
  console.error(`copy-store-products: ${message}`)
  process.exit(2)
}

const argv = process.argv.slice(2)
const opt = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }
const FROM = opt('--from'), TO = opt('--to'), WRITE = argv.includes('--yes')
if (!FROM || !TO || FROM === TO) fail('usage: --from <store> --to <other store> [--yes]')
const toFolder = loadTenant(TO).images.uploadFolder
loadTenant(FROM) // validates the slug names a real store
if (!toFolder) fail(`tenants/${TO}/tenant.json has no images.uploadFolder`)

const envFile = join(ROOT, '.env.local')
if (!existsSync(envFile)) fail('.env.local not found')
const env = Object.fromEntries(readFileSync(envFile, 'utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))
let host = ''
try { host = new URL(env.VITE_SUPABASE_URL ?? '').hostname } catch { /* reported below */ }
if (host !== PRODUCTION_HOST) fail(`VITE_SUPABASE_URL host is "${host}", expected ${PRODUCTION_HOST}`)
if (!env.SUPABASE_SERVICE_ROLE_KEY) fail('.env.local lacks SUPABASE_SERVICE_ROLE_KEY')

const service = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { headers: { 'x-tenant': TO } },
})
const check = (label, { error }) => { if (error) throw new Error(`${label}: ${error.message}`) }
const BUCKET_PREFIX = `${env.VITE_SUPABASE_URL}/storage/v1/object/public/product-images/`

// Copies a picture into the target store's folder; returns its new public URL.
async function copyPicture(url, slug, n) {
  if (!url.startsWith(BUCKET_PREFIX)) return url
  const source = decodeURIComponent(url.slice(BUCKET_PREFIX.length).split('?')[0])
  const ext = source.includes('.') ? source.slice(source.lastIndexOf('.')) : ''
  const dest = `${toFolder}/${slug}${n ? `-${n + 1}` : ''}${ext}`
  const { data, error } = await service.storage.from('product-images').download(source)
  if (error) throw new Error(`download ${source}: ${error.message}`)
  check(`upload ${dest}`, await service.storage.from('product-images').upload(dest, Buffer.from(await data.arrayBuffer()),
    { contentType: data.type || undefined, upsert: true, cacheControl: '300' }))
  return service.storage.from('product-images').getPublicUrl(dest).data.publicUrl
}

try {
  const src = await service.from('products').select('*, product_variants(*)')
    .eq('tenant', FROM).eq('is_available', true).order('created_at')
  check(`read ${FROM} products`, src)
  const have = await service.from('products').select('slug').eq('tenant', TO)
  check(`read ${TO} products`, have)
  const taken = new Set(have.data.map(r => r.slug))
  const todo = src.data.filter(p => !taken.has(p.slug))
  const skipped = src.data.filter(p => taken.has(p.slug))

  console.log(`${FROM} -> ${TO}: ${src.data.length} available product(s); ${todo.length} to copy, ${skipped.length} already in ${TO}`)
  for (const p of todo) {
    const options = (p.product_variants ?? []).map(v => `${v.label} R${v.price / 100}`).join(', ')
    console.log(`  + ${p.name} [${p.category}] R${p.price / 100}${options ? ` (options: ${options})` : ''}, ${p.images?.length ?? 0} picture(s)`)
  }
  for (const p of skipped) console.log(`  = ${p.name} (slug ${p.slug} already in ${TO}; skipped)`)
  if (!WRITE) {
    console.log('dry run: nothing written. Re-run with --yes to apply.')
    process.exit(0)
  }

  for (const p of todo) {
    const { id, tenant, created_at, product_variants: variants, ...fields } = p
    void id; void tenant; void created_at
    const images = await Promise.all((fields.images ?? []).map((u, i) => copyPicture(u, fields.slug, i)))
    const ins = await service.from('products')
      .insert({ ...fields, images, stock_quantity: NEW_STOCK, tenant: TO }).select('id').single()
    check(`insert ${fields.slug}`, ins)
    if (variants?.length) {
      check(`options ${fields.slug}`, await service.from('product_variants').insert(variants.map(v => ({
        product_id: ins.data.id, label: v.label, price: v.price, stock_quantity: NEW_STOCK,
        is_available: v.is_available, sort_order: v.sort_order, tenant: TO,
      }))))
    }
  }

  const after = await service.from('products').select('slug, tenant').eq('tenant', TO).in('slug', todo.map(p => p.slug))
  check('verify', after)
  if (after.data.length !== todo.length) throw new Error(`verify: expected ${todo.length} copied products, found ${after.data.length}`)
  console.log(`copied ${todo.length} product(s) into ${TO}; verify: PASS`)
} catch (err) {
  console.error(`copy-store-products: ${err.message}`)
  process.exit(1)
}
