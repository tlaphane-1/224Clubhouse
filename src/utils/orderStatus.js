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

export const PAYMENT_METHODS = ['cash_on_delivery', 'card_on_delivery']

export const PAYMENT_LABELS = {
  cash_on_delivery: 'Cash on Delivery',
  card_on_delivery: 'Card on Delivery',
  online: 'Paid Online',
}

export const statusLabel = (s) => STATUS_LABELS[s] ?? s
export const paymentLabel = (m) => PAYMENT_LABELS[m] ?? m
