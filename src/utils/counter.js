// Pure logic for the counter tablet's sale screen (part 2a). The server
// (record_counter_sale) re-prices and checks stock; this only drives the UI.

/** A product's QR label: its public store page (a phone camera opens it too). */
export function labelUrl(siteUrl, product, variant = null) {
  const url = `${siteUrl}/store/${product.slug}`
  return variant ? `${url}?v=${variant.id}` : url
}

/** { slug, variantId } from a scanned label, or null if it isn't one of this store's. */
export function parseLabelCode(text, hosts) {
  let url
  try {
    url = new URL(String(text ?? '').trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || !hosts.includes(url.hostname)) return null
  const match = url.pathname.match(/^\/store\/([a-z0-9-]+)\/?$/)
  if (!match) return null
  return { slug: match[1], variantId: url.searchParams.get('v') || null }
}

/** Counter cart: lines keyed by product (+ option); quantities kept within stock. */
export function counterCartReducer(state, action) {
  switch (action.type) {
    case 'add': {
      const { line } = action
      const existing = state.lines.find(l => l.key === line.key)
      if (existing) {
        return {
          lines: state.lines.map(l => (l.key === line.key
            ? { ...l, quantity: Math.min(l.quantity + 1, l.stock) }
            : l)),
        }
      }
      if (line.stock < 1) return state
      return { lines: [...state.lines, { ...line, quantity: 1 }] }
    }
    case 'setQty': {
      const lines = state.lines
        .map(l => (l.key === action.key ? { ...l, quantity: Math.max(0, Math.min(action.quantity, l.stock)) } : l))
        .filter(l => l.quantity > 0)
      return { lines }
    }
    case 'clear':
      return { lines: [] }
    default:
      return state
  }
}

export function cartTotal(lines) {
  return lines.reduce((sum, l) => sum + l.price * l.quantity, 0)
}

/** What record_counter_sale receives: ids, options and quantities — never prices. */
export function toSaleItems(lines) {
  return lines.map(l => (l.variantId
    ? { id: l.productId, variant_id: l.variantId, quantity: l.quantity }
    : { id: l.productId, quantity: l.quantity }))
}

const BADGES = {
  active: { label: 'Member', tone: 'good' },
  pending: { label: 'Membership pending', tone: 'warn' },
  expired: { label: 'Membership expired', tone: 'muted' },
  none: { label: 'Not a member', tone: 'muted' },
}

export function memberBadge(status) {
  return BADGES[status] ?? BADGES.none
}

/** One printable label per available option, or per product without options. */
export function labelSheetItems(products, siteUrl) {
  const out = []
  for (const p of products) {
    if (!p.is_available) continue
    const variants = p.product_variants ?? []
    if (variants.length === 0) {
      out.push({ key: p.id, name: p.name, option: null, price: p.price, url: labelUrl(siteUrl, p) })
      continue
    }
    for (const v of variants) {
      if (!v.is_available) continue
      out.push({ key: `${p.id}:${v.id}`, name: p.name, option: v.label, price: v.price, url: labelUrl(siteUrl, p, v) })
    }
  }
  return out
}

/** Why "Complete sale" is not ready yet, in the order the cashier fixes them. */
export function saleBlockers({ customer, lines, method, idChecked, onShift }) {
  const out = []
  if (!onShift) out.push('Start your shift first')
  if (!customer?.name?.trim() || !customer?.phone?.trim()) out.push('Choose a customer or walk-in')
  if (!lines?.length) out.push('Add at least one item')
  if (!method) out.push('Choose cash or card')
  if (!idChecked) out.push('Tick that you checked their ID')
  return out
}
