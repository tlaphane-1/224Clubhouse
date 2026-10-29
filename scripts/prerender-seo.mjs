/**
 * prerender-seo.mjs — post-build SEO + link-preview snapshots for the SPA.
 * Run automatically by `npm run build` (after `vite build`).
 *
 * Crawlers and link-preview bots (WhatsApp, Facebook, Google) don't run JS, so
 * every shareable URL needs its own static HTML with the right <title>, meta
 * description, Open Graph / Twitter tags and JSON-LD. Each generated file is a
 * full copy of dist/index.html, so the SPA still boots normally on top of it.
 *
 * Output layout relies on `"cleanUrls": true` in firebase.json: /store/foo is
 * served from dist/store/foo.html with a 200 and no redirect. (A directory
 * index — store/foo/index.html — would 301 /store/foo to /store/foo/ while
 * `trailingSlash` is unset.)
 *
 * Data comes from Supabase REST with the ANON key (public RLS reads only).
 * Network or env failures are warnings, never build failures: static pages and
 * a product-less sitemap are still written and the script exits 0.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { loadTenant } from '../tenants/loadTenant.mjs'

// Throws on an unknown TENANT or a tenant.json missing a field. Deliberately
// outside main(), whose catch exits 0: a wrong store must fail the build, not
// ship another store's (or no) SEO.
const tenant = loadTenant()
const SITE = tenant.domain.siteUrl
const SITE_NAME = tenant.name
const DESC_MAX = 155

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DIST = resolve(ROOT, 'dist')

// ── env: process.env first, then .env.local parsed by hand (same as the other scripts)
function loadEnv() {
  let file = {}
  const path = resolve(ROOT, '.env.local')
  if (existsSync(path)) {
    file = Object.fromEntries(
      readFileSync(path, 'utf-8').split('\n')
        .filter(l => l.includes('=') && !l.startsWith('#'))
        .map(l => l.split('=').map(s => s.trim()))
        .map(([k, ...v]) => [k, v.join('=')])
    )
  }
  return {
    url: process.env.VITE_SUPABASE_URL || file.VITE_SUPABASE_URL || '',
    key: process.env.VITE_SUPABASE_ANON_KEY || file.VITE_SUPABASE_ANON_KEY || '',
  }
}

// ── escaping
const escAttr = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;')
// JSON inside <script>: escaping `<` stops `</script>` / `<!--` breaking out.
const jsonForScript = obj => JSON.stringify(obj)
  .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
  .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')

function truncate(text, max = DESC_MAX) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max - 1)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > 60 ? cut.slice(0, lastSpace) : cut).replace(/[\s,.;:!-]+$/, '')}…`
}

// Fills {token} placeholders in the tenant's description templates. An unknown
// token throws rather than blanking, so a typo can't ship a description with a
// hole in it (validateTenant also rejects these before the build starts).
const fillTemplate = (template, values) =>
  template.replace(/\{(\w+)\}/g, (_, key) => {
    if (!(key in values)) throw new Error(`Unknown placeholder {${key}} in "${template}"`)
    return values[key] ?? ''
  })

const absUrl = u => {
  if (!u) return ''
  if (/^https?:\/\//i.test(u)) return u
  return `${SITE}${u.startsWith('/') ? '' : '/'}${u}`
}

// ── head rewriting
// Strip whatever SEO tags the template carries so nothing is duplicated, then
// inject a fresh set before </head>.
function stripSeo(html) {
  return html
    .replace(/<title>[\s\S]*?<\/title>\s*/i, '')
    .replace(/<meta\s+name=["']description["'][^>]*>\s*/gi, '')
    .replace(/<meta\s+(property|name)=["'](og|twitter):[^"']*["'][^>]*>\s*/gi, '')
    .replace(/<link\s+rel=["']canonical["'][^>]*>\s*/gi, '')
    .replace(/<script\s+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>\s*/gi, '')
}

function headTags({ title, description, path, type = 'website', image, imageSize, jsonLd }) {
  const url = path == null ? null : `${SITE}${path}`
  const tags = [
    `<title>${escAttr(title)}</title>`,
    `<meta name="description" content="${escAttr(description)}" />`,
  ]
  if (url) tags.push(`<link rel="canonical" href="${escAttr(url)}" />`)
  tags.push(
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:locale" content="${escAttr(tenant.seo.locale)}" />`,
    `<meta property="og:type" content="${escAttr(type)}" />`,
    `<meta property="og:title" content="${escAttr(title)}" />`,
    `<meta property="og:description" content="${escAttr(description)}" />`,
  )
  if (url) tags.push(`<meta property="og:url" content="${escAttr(url)}" />`)
  if (image) {
    tags.push(`<meta property="og:image" content="${escAttr(image)}" />`)
    if (imageSize) {
      tags.push(
        `<meta property="og:image:width" content="${imageSize[0]}" />`,
        `<meta property="og:image:height" content="${imageSize[1]}" />`,
      )
    }
    tags.push(`<meta property="og:image:alt" content="${escAttr(title)}" />`)
  }
  tags.push(
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escAttr(title)}" />`,
    `<meta name="twitter:description" content="${escAttr(description)}" />`,
  )
  if (image) tags.push(`<meta name="twitter:image" content="${escAttr(image)}" />`)
  if (jsonLd) tags.push(`<script type="application/ld+json">${jsonForScript(jsonLd)}</script>`)
  return tags.map(t => `    ${t}`).join('\n')
}

function render(template, meta) {
  return stripSeo(template).replace(/\s*<\/head>/i, `\n${headTags(meta)}\n  </head>`)
}

// Writes dist/<route>.html (cleanUrls serves it at /<route>).
function writePage(route, html) {
  const file = resolve(DIST, `${route.replace(/^\//, '')}.html`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, html)
}

// ── data
async function fetchRows(env, table, query) {
  const res = await fetch(`${env.url}/rest/v1/${table}?${query}`, {
    headers: { apikey: env.key, Authorization: `Bearer ${env.key}` },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`${table}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

async function loadData(env) {
  if (!env.url || !env.key) {
    console.warn('[prerender-seo] WARNING: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set — skipping product and event pages.')
    return { products: [], events: [] }
  }
  let products = []
  let events = []
  try {
    products = await fetchRows(env, 'products',
      'select=name,slug,description,price,images,category,stock_quantity&is_available=eq.true&order=created_at.desc')
  } catch (err) {
    console.warn(`[prerender-seo] WARNING: could not fetch products (${err.message}) — product pages skipped.`)
  }
  try {
    events = await fetchRows(env, 'events', 'select=id,title,description,date,image_url&order=date.asc')
  } catch (err) {
    console.warn(`[prerender-seo] WARNING: could not fetch events (${err.message}) — event pages skipped.`)
  }
  return { products, events }
}

// ── page definitions
const STATIC_ROUTES = [
  ...Object.entries(tenant.seo.routes).map(([path, r]) => (
    { path, title: `${r.title} | ${SITE_NAME}`, description: r.description }
  )),
]

function productMeta(p, logo) {
  const path = `/store/${encodeURIComponent(p.slug)}`
  const image = absUrl(Array.isArray(p.images) ? p.images.find(Boolean) : '') || null
  const inStock = (p.stock_quantity ?? 0) > 0
  const description = truncate(p.description) ||
    truncate(fillTemplate(tenant.seo.productDescription, { name: p.name }))
  const offer = {
    '@type': 'Offer',
    url: `${SITE}${path}`,
    priceCurrency: 'ZAR',
    price: (Number(p.price || 0) / 100).toFixed(2), // DB stores integer cents
    availability: `https://schema.org/${inStock ? 'InStock' : 'OutOfStock'}`,
    seller: { '@type': 'Organization', name: SITE_NAME },
  }
  return {
    path,
    meta: {
      title: `${p.name} | ${SITE_NAME}`,
      description,
      path,
      type: 'product',
      image: image || logo.url,
      imageSize: image ? null : logo.size,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: p.name,
        description: truncate(p.description, 5000) || description,
        ...(image ? { image: [image] } : {}),
        ...(p.category ? { category: p.category } : {}),
        brand: { '@type': 'Brand', name: SITE_NAME },
        offers: offer,
      },
    },
  }
}

function eventMeta(e, logo) {
  const path = `/events/${encodeURIComponent(e.id)}`
  const image = absUrl(e.image_url) || null
  const description = truncate(e.description) ||
    truncate(fillTemplate(tenant.seo.eventDescription, { name: e.title }))
  return {
    path,
    meta: {
      title: `${e.title} | ${SITE_NAME}`,
      description,
      path,
      type: 'website',
      image: image || logo.url,
      imageSize: image ? null : logo.size,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'Event',
        name: e.title,
        description: truncate(e.description, 5000) || description,
        ...(e.date ? { startDate: e.date } : {}),
        eventStatus: 'https://schema.org/EventScheduled',
        eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
        location: {
          '@type': 'Place',
          name: SITE_NAME,
          address: {
            '@type': 'PostalAddress',
            addressLocality: tenant.contact.city,
            addressRegion: tenant.contact.province,
            addressCountry: tenant.contact.country,
          },
        },
        ...(image ? { image: [image] } : {}),
        organizer: { '@type': 'Organization', name: SITE_NAME, url: SITE },
        url: `${SITE}${path}`,
      },
    },
  }
}

// ── sitemap + robots
function sitemap(paths, today) {
  const urls = paths.map(p => `  <url><loc>${escAttr(`${SITE}${p}`)}</loc><lastmod>${today}</lastmod></url>`)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`
}

const ROBOTS = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /checkout
Disallow: /cart
Disallow: /orders
Disallow: /account
Disallow: /reset-password
Disallow: /unsubscribe

Sitemap: ${SITE}/sitemap.xml
`

// ── main
async function main() {
  const templatePath = resolve(DIST, 'index.html')
  if (!existsSync(templatePath)) {
    console.error('[prerender-seo] dist/index.html not found — run `vite build` first.')
    process.exit(1)
  }
  const template = readFileSync(templatePath, 'utf-8')
  const env = loadEnv()
  // Without a Supabase URL there is no public storage root, so pages carry no
  // og:image rather than a broken relative one.
  const logo = {
    url: env.url ? `${env.url}/storage/v1/object/public/${tenant.images.logoWide}` : '',
    size: tenant.images.logoWideSize,
  }
  const today = new Date().toISOString().slice(0, 10)

  // dist/index.html is also the catch-all rewrite target for every other
  // route (/track, /cart, …), so it carries defaults but no canonical/og:url —
  // a canonical pointing at "/" would tell Google those pages are the home page.
  writeFileSync(templatePath, render(template, {
    title: tenant.seo.title,
    description: tenant.seo.description,
    path: null,
    image: logo.url,
    imageSize: logo.size,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: SITE_NAME,
      url: SITE,
      ...(logo.url ? { logo: logo.url } : {}),
    },
  }))

  for (const r of STATIC_ROUTES) {
    writePage(r.path, render(template, { ...r, image: logo.url, imageSize: logo.size }))
  }

  const { products, events } = await loadData(env)
  const productPaths = []
  for (const p of products) {
    if (!p.slug || !p.name) continue
    const { path, meta } = productMeta(p, logo)
    writePage(path, render(template, meta))
    productPaths.push(path)
  }
  const eventPaths = []
  for (const e of events) {
    if (e.id == null || !e.title) continue
    const { path, meta } = eventMeta(e, logo)
    writePage(path, render(template, meta))
    // Past events keep a page (shared links still preview) but leave the sitemap.
    if (!e.date || e.date >= today) eventPaths.push(path)
  }

  writeFileSync(resolve(DIST, 'sitemap.xml'),
    sitemap(['/', ...STATIC_ROUTES.map(r => r.path), ...productPaths, ...eventPaths], today))
  writeFileSync(resolve(DIST, 'robots.txt'), ROBOTS)

  console.log(`[prerender-seo] wrote ${STATIC_ROUTES.length} static, ${productPaths.length} product, ${events.length} event pages; sitemap has ${1 + STATIC_ROUTES.length + productPaths.length + eventPaths.length} URLs.`)
}

main().catch(err => {
  // Never fail the build over SEO snapshots.
  console.warn(`[prerender-seo] WARNING: ${err.stack || err.message}`)
  process.exit(0)
})
