/**
 * clean-images.js
 * Finds all images from the downloaded website, cleans filenames,
 * removes duplicates (keeps largest), and copies to ./224-images-staging/
 *
 * Run: node scripts/clean-images.js
 * Requires: ./224-website-download/ to exist (wget output)
 */

import { readdirSync, statSync, copyFileSync, mkdirSync, existsSync } from 'fs'
import { resolve, extname, basename, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SOURCE_DIR = resolve(__dirname, '../224-website-download/wp-content/uploads')
const STAGING_DIR = resolve(__dirname, '../224-images-staging')

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg']

// WordPress size suffixes to strip: -300x300, -150x150, -1024x576, -scaled, -e1234567890, etc.
const WP_SUFFIX_RE = /(-\d+x\d+)+|-scaled|-e\d{7,}|-\d{13}$/

function cleanFilename(original) {
  const ext = extname(original).toLowerCase()
  let base = basename(original, extname(original))

  // Strip WordPress size/timestamp suffixes
  base = base.replace(WP_SUFFIX_RE, '')

  // Lowercase, replace spaces and underscores with hyphens
  base = base
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9.-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  return base + ext
}

function walkDir(dir, found = []) {
  if (!existsSync(dir)) return found
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      walkDir(full, found)
    } else if (IMAGE_EXTS.includes(extname(entry).toLowerCase())) {
      found.push({ path: full, size: stat.size, name: entry })
    }
  }
  return found
}

function cleanImages() {
  console.log(`🔍  Scanning ${SOURCE_DIR}\n`)

  const allImages = walkDir(SOURCE_DIR)
  console.log(`Found ${allImages.length} total image files.\n`)

  if (allImages.length === 0) {
    console.error('No images found. Make sure wget completed successfully.')
    process.exit(1)
  }

  // Group by clean base name — keep largest file for each
  const groups = new Map()

  for (const img of allImages) {
    const cleanName = cleanFilename(img.name)
    const existing = groups.get(cleanName)
    if (!existing || img.size > existing.size) {
      groups.set(cleanName, { ...img, cleanName })
    }
  }

  console.log(`After deduplication: ${groups.size} unique images.\n`)

  // Create staging dir
  mkdirSync(STAGING_DIR, { recursive: true })

  let copied = 0
  for (const [cleanName, img] of groups) {
    const dest = resolve(STAGING_DIR, cleanName)
    copyFileSync(img.path, dest)
    const kb = (img.size / 1024).toFixed(1)
    console.log(`  ${img.name.padEnd(60)} → ${cleanName}  (${kb} KB)`)
    copied++
  }

  console.log(`\n✅  ${copied} images copied to ./224-images-staging/`)
  console.log('\nFinal image list:')
  for (const cleanName of [...groups.keys()].sort()) {
    console.log(`  • ${cleanName}`)
  }
}

cleanImages()
