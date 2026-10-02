/**
 * upload-images.js
 * Uploads cleaned website images to the correct Supabase storage buckets.
 *
 * Run: node scripts/upload-images.js
 * Requires:
 *   - VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local
 *   - Cleaned images already in ./224-images-staging/
 *   - Buckets already created via setup-buckets.js
 *
 * Generates: scripts/image-manifest.json with all public URLs.
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, readdirSync, writeFileSync, statSync } from 'fs'
import { resolve, extname, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const STAGING_DIR = resolve(__dirname, '../224-images-staging')

// Parse .env.local
function loadEnv() {
  const envPath = resolve(__dirname, '../.env.local')
  const lines = readFileSync(envPath, 'utf-8').split('\n')
  const env = {}
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const [key, ...valueParts] = trimmed.split('=')
    env[key.trim()] = valueParts.join('=').trim()
  }
  return env
}

const env = loadEnv()
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const MIME_MAP = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
}

// Categorize image into a bucket based on filename keywords
function categorize(filename) {
  const lower = filename.toLowerCase()

  const brandKeywords = ['logo', 'fav', 'icon', 'banner', 'hero', 'clubhouse', 'brand', 'interior', 'lounge', 'venue', 'vibe', 'lifestyle', '224']
  const productKeywords = ['product', 'flower', 'edible', 'accessory', 'merch', 'weed', 'bud', 'strain', 'joint', 'preroll', 'gummy', 'tincture']
  const eventKeywords = ['event', 'party', 'session', 'night', 'sesh', 'gathering', 'celebration']

  if (productKeywords.some(k => lower.includes(k))) return { bucket: 'product-images', category: 'product' }
  if (eventKeywords.some(k => lower.includes(k))) return { bucket: 'event-images', category: 'event' }
  if (brandKeywords.some(k => lower.includes(k))) return { bucket: 'brand-assets', category: 'brand' }

  // Default: treat as brand asset (venue/lifestyle shots)
  return { bucket: 'brand-assets', category: 'brand' }
}

async function uploadImages() {
  console.log(`📁  Reading images from ${STAGING_DIR}\n`)

  let files
  try {
    files = readdirSync(STAGING_DIR).filter(f => {
      const ext = extname(f).toLowerCase()
      return Object.keys(MIME_MAP).includes(ext)
    })
  } catch {
    console.error('❌  Staging directory not found. Run the image cleaning step first.')
    process.exit(1)
  }

  if (files.length === 0) {
    console.error('❌  No image files found in staging directory.')
    process.exit(1)
  }

  console.log(`Found ${files.length} images to upload.\n`)

  const manifest = []
  let successCount = 0
  let errorCount = 0

  for (const filename of files) {
    const filePath = resolve(STAGING_DIR, filename)
    const ext = extname(filename).toLowerCase()
    const contentType = MIME_MAP[ext] || 'image/jpeg'
    const { bucket, category } = categorize(filename)

    try {
      const buffer = readFileSync(filePath)

      const { error } = await supabase.storage
        .from(bucket)
        .upload(filename, buffer, { contentType, upsert: true })

      if (error) throw error

      const { data: urlData } = supabase.storage
        .from(bucket)
        .getPublicUrl(filename)

      const publicUrl = urlData.publicUrl

      manifest.push({
        originalName: filename,
        cleanName: filename,
        bucket,
        publicUrl,
        category,
      })

      console.log(`✅  ${filename}`)
      console.log(`    → ${bucket} | ${publicUrl}\n`)
      successCount++
    } catch (err) {
      console.error(`✗   ${filename} — ${err.message}`)
      errorCount++
    }
  }

  // Write manifest
  const manifestPath = resolve(__dirname, 'image-manifest.json')
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

  console.log('\n' + '─'.repeat(60))
  console.log(`✅  ${successCount} uploaded  |  ✗ ${errorCount} failed`)
  console.log(`📄  Manifest saved to scripts/image-manifest.json`)
  console.log(`    ${manifest.length} total images across ${[...new Set(manifest.map(m => m.bucket))].join(', ')}`)
}

uploadImages().catch(err => {
  console.error('Fatal error:', err.message)
  process.exit(1)
})
