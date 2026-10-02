/**
 * fetch-product-images.js
 * Fetches CC-licensed images from Wikimedia Commons per product,
 * uploads to Supabase product-images bucket, and patches the DB.
 *
 * No API key required.
 * Run: node scripts/fetch-product-images.js
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, mkdirSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const envContent = readFileSync(resolve(__dirname, '../.env.local'), 'utf-8')
const env = Object.fromEntries(
  envContent.split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => l.split('=').map(s => s.trim()))
    .map(([k, ...v]) => [k, v.join('=')])
)

const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const CACHE_DIR = resolve(__dirname, '../224-product-images-staging')

// Licenses that allow commercial use
const COMMERCIAL_LICENSES = [
  'cc0', 'cc-by', 'cc-by-sa', 'public domain', 'pd', 'cc by', 'cc by-sa',
]

function isCommercialOk(license = '') {
  const l = license.toLowerCase()
  return COMMERCIAL_LICENSES.some(ok => l.includes(ok))
}

// ─── Search terms per slug ───────────────────────────────────────────────────

const SEARCH_TERMS = {
  // Flower — search Wikimedia for the strain directly
  'og-kush-1g':            'OG Kush cannabis',
  'durban-poison-1g':      'Durban Poison cannabis sativa',
  'purple-punch-1g':       'Purple Punch cannabis indica',
  'gorilla-glue-4-eighth': 'Gorilla Glue cannabis',
  'blue-dream-1g':         'Blue Dream cannabis',
  'zkittlez-1g':           'Zkittlez cannabis',
  // Edibles
  'infused-gummies-10pack':    'gummy bears candy fruit',
  'infused-dark-chocolate-bar':'dark chocolate bar',
  'space-cookies-2pack':       'chocolate chip cookies baked',
  'infused-honey-50ml':        'raw honey jar',
  // Accessories
  'aluminium-grinder-4part':   'herb grinder metal',
  'raw-papers-king-size':      'rolling papers cigarette',
  'glass-spoon-pipe':          'glass pipe smoking',
  '224-rolling-tray':          'metal tray flat',
  'clipper-lighter':           'clipper lighter',
  // Merchandise — generic clothing shots from Commons
  '224-tshirt':       'black t-shirt',
  '224-hoodie':       'hoodie sweatshirt black',
  '224-dad-cap':      'baseball cap black',
  '224-tote-bag':     'canvas tote bag',
  '224-sticker-pack': 'sticker collection assorted',
}

// ─── Wikimedia Commons API helpers ──────────────────────────────────────────

async function searchCommons(query, limit = 10) {
  const url = new URL('https://commons.wikimedia.org/w/api.php')
  url.searchParams.set('action', 'query')
  url.searchParams.set('generator', 'search')
  url.searchParams.set('gsrsearch', query)
  url.searchParams.set('gsrnamespace', '6')       // File namespace
  url.searchParams.set('gsrlimit', String(limit))
  url.searchParams.set('prop', 'imageinfo')
  url.searchParams.set('iiprop', 'url|extmetadata|mime|size')
  url.searchParams.set('iiurlwidth', '1000')       // Request 1000px wide thumbnail
  url.searchParams.set('format', 'json')
  url.searchParams.set('origin', '*')

  const res = await fetch(url.toString(), {
    headers: { 'User-Agent': '224Clubhouse/1.0 (team@224clubhouse.co.za)' },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`Commons API error: ${res.status}`)
  const data = await res.json()
  return Object.values(data?.query?.pages ?? {})
}

function pickBestImage(pages) {
  // Prefer images with commercial-compatible licenses, then pick largest
  const candidates = pages
    .map(p => {
      const info = p.imageinfo?.[0]
      if (!info) return null
      const mime = info.mime ?? ''
      if (!mime.startsWith('image/')) return null
      // Skip SVGs and tiny images
      if (mime === 'image/svg+xml') return null
      if ((info.size ?? 0) < 20000) return null

      const meta = info.extmetadata ?? {}
      const license = (meta.LicenseShortName?.value ?? meta.License?.value ?? '').toLowerCase()
      const isOk = isCommercialOk(license)

      return {
        url: info.thumburl || info.url,
        license: meta.LicenseShortName?.value ?? 'unknown',
        artist: meta.Artist?.value?.replace(/<[^>]+>/g, '') ?? 'Unknown',
        isOk,
        size: info.size ?? 0,
      }
    })
    .filter(Boolean)

  // Prefer commercial-ok, then by size
  const ok = candidates.filter(c => c.isOk)
  const pool = ok.length ? ok : candidates
  return pool.sort((a, b) => b.size - a.size)[0] ?? null
}

async function downloadBuffer(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': '224Clubhouse/1.0 (team@224clubhouse.co.za)' },
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error(`Download failed: ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function processProduct(product) {
  const term = SEARCH_TERMS[product.slug]
  if (!term) {
    console.log(`  ⚠️   No search term for "${product.slug}" — skipping`)
    return
  }

  try {
    const pages = await searchCommons(term, 12)
    if (!pages.length) {
      console.log(`  ⚠️   No Commons results for "${term}"`)
      return
    }

    const pick = pickBestImage(pages)
    if (!pick) {
      console.log(`  ⚠️   No usable image found for "${product.name}"`)
      return
    }

    // Determine file extension from URL
    const ext = pick.url.match(/\.(jpe?g|png|webp|gif)/i)?.[1]?.toLowerCase() ?? 'jpg'
    const filename = `${product.slug}.${ext}`

    const buffer = await downloadBuffer(pick.url)

    // Cache locally
    mkdirSync(CACHE_DIR, { recursive: true })
    writeFileSync(resolve(CACHE_DIR, filename), buffer)

    // Upload to Supabase
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
    const { error: uploadError } = await supabase.storage
      .from('product-images')
      .upload(filename, buffer, { contentType: mime, upsert: true })

    if (uploadError) throw new Error(uploadError.message)

    const { data: urlData } = supabase.storage.from('product-images').getPublicUrl(filename)

    // Patch DB
    const { error: dbError } = await supabase
      .from('products')
      .update({ images: [urlData.publicUrl] })
      .eq('slug', product.slug)

    if (dbError) throw new Error(dbError.message)

    const licenseTag = pick.isOk ? `✅ ${pick.license}` : `⚠️  ${pick.license} (verify)`
    console.log(`  ✅  ${product.name.padEnd(38)} ${licenseTag}`)
    console.log(`       👤 ${pick.artist}`)

  } catch (err) {
    console.error(`  ❌  ${product.name}: ${err.message}`)
  }

  // Be polite to Wikimedia servers
  await new Promise(r => setTimeout(r, 500))
}

async function main() {
  console.log('🌐  Fetching product images from Wikimedia Commons...\n')

  const { data: products, error } = await supabase
    .from('products')
    .select('id, name, slug, category')
    .order('category')

  if (error) {
    console.error('❌  Could not fetch products:', error.message)
    process.exit(1)
  }

  console.log(`Found ${products.length} products.\n`)

  for (const product of products) {
    await processProduct(product)
  }

  console.log('\n✅  Done! Check ⚠️  items manually for license confirmation.')
  console.log(`📁  Local cache: ./224-product-images-staging/`)
}

main().catch(err => {
  console.error('\nFatal:', err.message)
  process.exit(1)
})
