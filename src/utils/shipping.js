// Mirrors place_cod_order (migration 20261001120000) — keep the two in step.
// The server recomputes the fee; these values only drive what the cart shows.
export const SHIPPING_THRESHOLD = 50000 // R500 in cents
export const SHIPPING_FEE = 3000 // R30 in cents

// Active members always get free delivery; everyone else at R500+ (judged on
// the PRE-discount subtotal so a discount can never take free delivery away).
export function shippingFeeFor(subtotal, isMember = false) {
  return isMember || subtotal >= SHIPPING_THRESHOLD ? 0 : SHIPPING_FEE
}
