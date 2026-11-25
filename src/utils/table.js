// Table mode helpers (part 3). A membership card QR is the store address plus
// /m/<token>; the token is unguessable and only the server can look it up.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The table screen goes back to the menu after 3 minutes without a touch. */
export const IDLE_MS = 3 * 60 * 1000

export function memberCardUrl(siteUrl, token) {
  return `${siteUrl}/m/${token}`
}

/** The card token from a scanned QR, or null if it isn't one of this store's cards. */
export function parseMemberCode(text, hosts) {
  let url
  try {
    url = new URL(String(text ?? '').trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || !hosts.includes(url.hostname)) return null
  const match = url.pathname.match(/^\/m\/([^/]+)\/?$/)
  return match && UUID.test(match[1]) ? match[1].toLowerCase() : null
}

/** Counter cart lines for a table order; items that can't be sold now are skipped. */
export function requestToLines(items) {
  const lines = []
  const skipped = []
  for (const i of items ?? []) {
    if (!i.available || i.stock < 1) {
      skipped.push(i.name)
      continue
    }
    lines.push({
      key: i.variant_id ? `${i.id}:${i.variant_id}` : i.id,
      productId: i.id,
      variantId: i.variant_id ?? null,
      name: i.name,
      label: i.label ?? null,
      price: i.price,
      stock: i.stock,
      quantity: Math.min(i.quantity, i.stock),
    })
  }
  return { lines, skipped }
}

export function firstName(full) {
  return String(full ?? '').trim().split(/\s+/)[0] || 'there'
}
