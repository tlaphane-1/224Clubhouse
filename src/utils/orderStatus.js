/**
 * Shared order status + payment-method vocabulary for the Cash/Card-on-Delivery
 * flow. Used by checkout, the customer tracking page, and the admin orders page
 * so labels and ordering never drift.
 */

// The delivery happy-path, in order (used to render the tracking timeline).
export const STATUS_STEPS = ['pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered']

// All statuses an order can hold (includes legacy online-payment values).
export const ALL_STATUSES = [
  'pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled',
]

// Human labels.
export const STATUS_LABELS = {
  pending: 'Order Placed',
  confirmed: 'Confirmed',
  preparing: 'Preparing',
  out_for_delivery: 'Out for Delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  // legacy
  paid: 'Paid',
  processing: 'Processing',
  shipped: 'Shipped',
}

// Tailwind classes per status for badges/pills (uses project tokens only).
export const STATUS_BADGE = {
  pending: 'bg-muted/10 text-muted border border-border',
  confirmed: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
  preparing: 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20',
  out_for_delivery: 'bg-gold/10 text-gold border border-gold/20',
  delivered: 'bg-green-500/10 text-green-400 border border-green-500/20',
  cancelled: 'bg-red-500/10 text-red-400 border border-red-500/20',
  paid: 'bg-green-500/10 text-green-400 border border-green-500/20',
  processing: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
  shipped: 'bg-gold/10 text-gold border border-gold/20',
}

export const PAYMENT_METHODS = ['cash_on_delivery', 'card_on_delivery', 'eft']

export const PAYMENT_LABELS = {
  cash_on_delivery: 'Cash on Delivery',
  card_on_delivery: 'Card on Delivery',
  eft: 'EFT (Bank Transfer)',
  online: 'Paid Online',
}

export const statusLabel = (s) => STATUS_LABELS[s] ?? s
export const paymentLabel = (m) => PAYMENT_LABELS[m] ?? m

/**
 * An EFT order the customer may still need to pay: the bank details must be
 * shown wherever the order is shown. Once delivered or cancelled there is
 * nothing to pay.
 */
export const eftAwaitingPayment = (order) =>
  order?.payment_method === 'eft' && !order?.paid_at && !['delivered', 'cancelled'].includes(order?.status)

/**
 * Admin-facing EFT state: 'paid', 'proof' (customer uploaded proof, money not
 * yet confirmed), 'awaiting', or null (not EFT / nothing to check).
 */
export function eftState(order) {
  if (order?.payment_method !== 'eft') return null
  if (order.paid_at) return 'paid'
  if (['delivered', 'cancelled'].includes(order.status)) return null
  return order.payment_proof_uploaded_at ? 'proof' : 'awaiting'
}

/** Statuses an unpaid EFT order may not move to (admin_update_order_status gate). */
export const EFT_GATED_STATUSES = ['preparing', 'out_for_delivery', 'delivered']
