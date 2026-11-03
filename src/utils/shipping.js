import { tenant } from '../tenant'

// Mirrors place_cod_order (migration 20261102140000) — keep the two in step.
// The server recomputes the fee; these values only drive what the cart shows.
// They are per store in tenant.json (delivery.*), and today every store's
// numbers must equal the server's fixed R30 fee / R500 threshold.
export const SHIPPING_THRESHOLD = tenant.delivery.freeFromCents
export const SHIPPING_FEE = tenant.delivery.feeCents

// Whether the store advertises "free delivery for members" in its marketing
// copy (hero, membership band, upsells). The fee itself is unaffected: the
// server waives it for active members in every store.
export const PROMOTE_MEMBER_FREE_DELIVERY = tenant.delivery.promoteMemberFreeDelivery

// Active members always get free delivery; everyone else at R500+ (judged on
// the PRE-discount subtotal so a discount can never take free delivery away).
export function shippingFeeFor(subtotal, isMember = false) {
  return isMember || subtotal >= SHIPPING_THRESHOLD ? 0 : SHIPPING_FEE
}
