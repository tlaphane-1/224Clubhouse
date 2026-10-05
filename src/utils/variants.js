// Product options (product_variants, migration 20261005140000). Pure helpers,
// no React — shared by the storefront, cart and order views, and unit-tested.

/** Every option row, in the admin's display order (unavailable ones included). */
export function sortedVariants(product) {
  const rows = Array.isArray(product?.product_variants) ? product.product_variants : []
  return [...rows].sort((a, b) => (a.sort_order - b.sort_order) || a.label.localeCompare(b.label))
}

/**
 * True when the product is sold in options. Matches place_cod_order, which
 * requires a variant_id as soon as ANY option row exists — even if every
 * option is currently switched off — so the storefront never offers a plain
 * "Add" the server would reject.
 */
export function hasVariants(product) {
  return sortedVariants(product).length > 0
}

/** Options a shopper can pick: available ones only. */
export function purchasableVariants(product) {
  return sortedVariants(product).filter(v => v.is_available)
}

/**
 * Cheapest and dearest available option prices, in cents, or null when the
 * product has no options. The sync trigger already sets products.price to the
 * minimum; this also tells the card whether to say "From".
 */
export function variantPriceRange(product) {
  const prices = purchasableVariants(product).map(v => v.price)
  if (prices.length === 0) return null
  return { min: Math.min(...prices), max: Math.max(...prices) }
}

/**
 * The cart line for a product (and the chosen option, if any). Price and stock
 * come from the option, so the reducer's stock clamp and the subtotal stay
 * right. The embedded option list is dropped to keep localStorage lean.
 */
export function toCartItem(product, variant = null) {
  const { product_variants: _omit, ...base } = product
  if (!variant) return base
  return {
    ...base,
    variant_id: variant.id,
    variant_label: variant.label,
    price: variant.price,
    stock_quantity: variant.stock_quantity,
  }
}

/** Identity of a cart line: the same product in two options is two lines. */
export function cartLineKey(item) {
  return item.variant_id ? `${item.id}:${item.variant_id}` : item.id
}

/** "Name — Option" for a cart line or a stored order line. */
export function lineName(item) {
  return item?.variant_label ? `${item.name} — ${item.variant_label}` : (item?.name ?? '')
}
