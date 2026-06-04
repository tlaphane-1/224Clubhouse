/**
 * useStorageImages.js
 * Provides typed access to Supabase storage images from the generated manifest.
 * All URLs are public and static — no API call needed.
 */

import manifest from '../../scripts/image-manifest.json'

const BASE = 'https://aogdkqczvlffgydgxsmz.supabase.co/storage/v1/object/public'

// Named references to key brand assets
export const BRAND_IMAGES = {
  logo: `${BASE}/brand-assets/224-logo-fav-1.png`,
  logoWide: `${BASE}/brand-assets/224-logo-fav-1-480x142.png`,
  favicon: `${BASE}/brand-assets/224-logo-fav.png`,
  header: `${BASE}/brand-assets/224-header-1.jpg`,
  gallery: [
    `${BASE}/brand-assets/224-square-images.jpg`,
    `${BASE}/brand-assets/224-square-images-1.jpg`,
    `${BASE}/brand-assets/224-square-images-2.jpg`,
    `${BASE}/brand-assets/1-1.jpg`,
    `${BASE}/brand-assets/2.jpg`,
    `${BASE}/brand-assets/3.jpg`,
    `${BASE}/brand-assets/5.jpg`,
    `${BASE}/brand-assets/6.jpg`,
    `${BASE}/brand-assets/7.jpg`,
    `${BASE}/brand-assets/whatsapp-image-2026-02-24-at-10.03.48-pm.jpeg`,
    `${BASE}/brand-assets/whatsapp-image-2026-02-24-at-10.03.51-pm.jpeg`,
    `${BASE}/brand-assets/whatsapp-image-2026-02-24-at-10.03.54-pm.jpeg`,
    `${BASE}/brand-assets/whatsapp-image-2026-02-24-at-10.03.54-pm-1.jpeg`,
    `${BASE}/brand-assets/whatsapp-image-2026-02-24-at-10.03.54-pm-2.jpeg`,
    `${BASE}/brand-assets/whatsapp-image-2026-02-24-at-10.03.56-pm.jpeg`,
  ],
}

/**
 * Returns a public URL for any file in a Supabase storage bucket.
 * @param {string} bucket - e.g. 'product-images'
 * @param {string} filename - e.g. 'og-kush.jpg'
 */
export function storageUrl(bucket, filename) {
  return `${BASE}/${bucket}/${filename}`
}

/**
 * React hook — exposes the full image manifest plus helper utilities.
 */
export function useStorageImages() {
  function byCategory(category) {
    return manifest.filter((img) => img.category === category)
  }

  function byBucket(bucket) {
    return manifest.filter((img) => img.bucket === bucket)
  }

  function find(cleanName) {
    return manifest.find((img) => img.cleanName === cleanName) ?? null
  }

  return {
    manifest,
    brand: BRAND_IMAGES,
    byCategory,
    byBucket,
    find,
    storageUrl,
  }
}
