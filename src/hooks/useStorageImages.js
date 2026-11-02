/**
 * useStorageImages.js
 * Provides typed access to Supabase storage images from the generated manifest.
 * All URLs are public and static — no API call needed.
 */

import manifest from '../../scripts/image-manifest.json'
import { tenant, storagePublicUrl } from '../tenant'

// Brand image paths (bucket/file) come from tenant.json; storagePublicUrl
// builds them off the same VITE_SUPABASE_URL the Supabase client uses, so
// images and data never point at different projects.
// Named references to key brand assets
export const BRAND_IMAGES = {
  logo: storagePublicUrl(tenant.images.logo),
  logoWide: storagePublicUrl(tenant.images.logoWide),
  favicon: storagePublicUrl(tenant.images.favicon),
  header: storagePublicUrl(tenant.images.header),
  gallery: tenant.images.gallery.map(storagePublicUrl),
}

/**
 * Returns a public URL for any file in a Supabase storage bucket.
 * @param {string} bucket - e.g. 'product-images'
 * @param {string} filename - e.g. 'og-kush.jpg'
 */
export function storageUrl(bucket, filename) {
  return storagePublicUrl(`${bucket}/${filename}`)
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
