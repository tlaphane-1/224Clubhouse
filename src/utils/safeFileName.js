/**
 * Turn an arbitrary uploaded filename into an ASCII-safe Supabase Storage key.
 * Storage rejects keys with unicode/accented characters (e.g. "café (1).jpg")
 * as "Invalid key", which silently breaks admin image uploads. This strips
 * diacritics and any non [a-z0-9] characters from the base name while keeping
 * a clean extension.
 *
 *   "café-photö.JPG"            -> "cafe-photo.jpg"
 *   "WhatsApp Image (1).jpeg"   -> "whatsapp-image-1.jpeg"
 */
export function safeFileName(filename) {
  const dot = filename.lastIndexOf('.')
  const ext = (dot >= 0 ? filename.slice(dot + 1) : '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '') || 'jpg'
  const base = (dot >= 0 ? filename.slice(0, dot) : filename)
    .normalize('NFKD')              // decompose accents (é -> e + ´)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')    // everything else -> hyphen
    .replace(/^-+|-+$/g, '')        // trim leading/trailing hyphens
    .slice(0, 40) || 'image'
  return `${base}.${ext}`
}
