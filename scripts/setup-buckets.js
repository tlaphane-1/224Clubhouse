/**
 * setup-buckets.js
 * Creates Supabase storage buckets for the 224 Clubhouse app.
 *
 * Run: node scripts/setup-buckets.js
 * Requires: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Parse .env.local manually (dotenv doesn't load .env.local by default)
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

const BUCKETS = [
  {
    id: 'product-images',
    public: true,
    fileSizeLimit: 5 * 1024 * 1024, // 5MB
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  },
  {
    id: 'event-images',
    public: true,
    fileSizeLimit: 5 * 1024 * 1024,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  },
  {
    id: 'brand-assets',
    public: true,
    fileSizeLimit: 2 * 1024 * 1024, // 2MB
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'],
  },
]

async function setupBuckets() {
  console.log('🪣  Setting up Supabase storage buckets...\n')

  for (const bucket of BUCKETS) {
    // Check if bucket already exists
    const { data: existing } = await supabase.storage.getBucket(bucket.id)

    if (existing) {
      console.log(`✓  "${bucket.id}" — already exists, skipping`)
      continue
    }

    const { data, error } = await supabase.storage.createBucket(bucket.id, {
      public: bucket.public,
      fileSizeLimit: bucket.fileSizeLimit,
      allowedMimeTypes: bucket.allowedMimeTypes,
    })

    if (error) {
      console.error(`✗  "${bucket.id}" — ERROR: ${error.message}`)
    } else {
      console.log(`✅  "${bucket.id}" — created (public: ${bucket.public}, max: ${bucket.fileSizeLimit / 1024 / 1024}MB)`)
    }
  }

  console.log('\n✅  Bucket setup complete.')
}

setupBuckets().catch(err => {
  console.error('Fatal error:', err.message)
  process.exit(1)
})
