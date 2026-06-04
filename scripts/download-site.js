/**
 * download-site.js
 * Crawls https://224clubhouse.co.za/ and downloads all images, CSS, and fonts.
 * Saves everything into ./224-website-download/
 *
 * Run: node scripts/download-site.js
 */

import { load } from 'cheerio'
import { mkdirSync, existsSync, writeFileSync, readdirSync, statSync } from 'fs'
import { resolve, dirname, extname, basename } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BASE_URL = 'https://224clubhouse.co.za'
const OUT_DIR = resolve(__dirname, '../224-website-download')

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.ico'])
const ASSET_EXTS = new Set(['.css', '.woff', '.woff2', '.ttf', '.eot'])

const visited = new Set()
const downloadedAssets = new Set()

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; site-archiver/1.0)' },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.text()
}

async function downloadFile(url, destDir) {
  if (downloadedAssets.has(url)) return
  downloadedAssets.add(url)

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) return

    // Build local path mirroring URL structure
    const urlObj = new URL(url)
    const relPath = urlObj.pathname.replace(/^\//, '')
    const localPath = resolve(destDir, relPath.replace(/\//g, '/'))
    const localDir = dirname(localPath)
    mkdirSync(localDir, { recursive: true })

    const buffer = await res.arrayBuffer()
    const { writeFileSync } = await import('fs')
    writeFileSync(localPath, Buffer.from(buffer))
    process.stdout.write('.')
    return localPath
  } catch {
    // silently skip failed downloads
  }
}

function extractUrls(html, pageUrl) {
  const $ = load(html)
  const urls = { images: [], assets: [], pages: [] }
  const base = new URL(pageUrl)

  const resolve224 = (href) => {
    try {
      const u = new URL(href, base)
      return u.hostname.includes('224clubhouse.co.za') ? u.href : null
    } catch { return null }
  }

  // Images: src, data-src, srcset
  $('img').each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src')
    if (src) { const u = resolve224(src); if (u) urls.images.push(u) }
    const srcset = $(el).attr('srcset') || $(el).attr('data-srcset') || ''
    for (const part of srcset.split(',')) {
      const u = resolve224(part.trim().split(' ')[0]); if (u) urls.images.push(u)
    }
  })

  // Background images in style attrs
  $('[style]').each((_, el) => {
    const style = $(el).attr('style') || ''
    const match = style.match(/url\(['"]?([^'")\s]+)['"]?\)/g) || []
    for (const m of match) {
      const inner = m.match(/url\(['"]?([^'")\s]+)['"]?\)/)[1]
      const u = resolve224(inner); if (u) urls.images.push(u)
    }
  })

  // CSS files
  $('link[rel="stylesheet"]').each((_, el) => {
    const href = $(el).attr('href')
    if (href) { const u = resolve224(href); if (u) urls.assets.push(u) }
  })

  // All <a> links on same domain (for page crawling)
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href')
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return
    const u = resolve224(href)
    if (u) {
      const ext = extname(new URL(u).pathname).toLowerCase()
      if (!ext || ext === '.html' || ext === '.php') urls.pages.push(u)
    }
  })

  // Also grab all wp-content/uploads URLs from raw HTML (catches lazy-loaded)
  const uploadsRe = /https?:\/\/224clubhouse\.co\.za\/wp-content\/uploads\/[^\s"')>]+\.(jpe?g|png|webp|gif|svg)/gi
  let m
  while ((m = uploadsRe.exec(html)) !== null) urls.images.push(m[0])

  return urls
}

async function crawlPage(url, destDir, depth = 0) {
  const clean = url.split('?')[0].split('#')[0]
  if (visited.has(clean) || depth > 3) return
  visited.add(clean)

  try {
    const html = await fetchText(url)
    const ext = extname(new URL(url).pathname)
    if (!ext || ext === '.html' || ext === '.php' || ext === '') {
      // Save HTML
      const urlObj = new URL(url)
      let relPath = urlObj.pathname.replace(/^\//, '') || 'index'
      if (!extname(relPath)) relPath = relPath.replace(/\/$/, '') + '/index.html'
      const localPath = resolve(destDir, relPath)
      mkdirSync(dirname(localPath), { recursive: true })
      writeFileSync(localPath, html)
    }

    const { images, assets, pages } = extractUrls(html, url)

    // Download images
    for (const imgUrl of [...new Set(images)]) {
      await downloadFile(imgUrl, destDir)
    }

    // Download CSS/fonts
    for (const assetUrl of [...new Set(assets)]) {
      await downloadFile(assetUrl, destDir)
    }

    // Crawl sub-pages (limited depth)
    if (depth < 2) {
      for (const pageUrl of [...new Set(pages)]) {
        const cleanPage = pageUrl.split('?')[0].split('#')[0]
        if (!visited.has(cleanPage)) {
          await crawlPage(pageUrl, destDir, depth + 1)
        }
      }
    }
  } catch (err) {
    console.error(`\n  Error crawling ${url}: ${err.message}`)
  }
}

function printImages(dir, prefix = '') {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry)
    const isDir = statSync(full).isDirectory()
    if (isDir) printImages(full, prefix + entry + '/')
    else if (IMAGE_EXTS.has(extname(entry).toLowerCase())) console.log(`  ${prefix}${entry}`)
  }
}

async function main() {
  console.log(`🌐  Crawling ${BASE_URL}\n`)
  mkdirSync(OUT_DIR, { recursive: true })

  await crawlPage(BASE_URL, OUT_DIR)

  console.log(`\n\n✅  Done! Downloaded ${downloadedAssets.size} assets from ${visited.size} pages.`)
  console.log(`📁  Saved to: ${OUT_DIR}`)

  // List the uploads directory contents
  console.log('\n📸  Downloaded images:')
  printImages(OUT_DIR)
}

main().catch(err => {
  console.error('\nFatal:', err.message)
  process.exit(1)
})
