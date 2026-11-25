// Email wording that depends on how a store fulfils orders: 'delivery'
// (address, fee, drivers) or 'collect' (order online, collect at the club).
// Pure data and helpers, no Deno-only imports, so the unit tests load it too.
//
// A collect store keeps the same stored statuses (approach A in
// docs/superpowers/specs/2026-11-24-collect-only-fulfilment-design.md):
// 'out_for_delivery' means "ready for collection" and 'delivered' means
// "collected".

export type Fulfilment = 'delivery' | 'collect'
export interface StatusCopy { subject: string; heading: string; message: string }

// {store} in a subject or message is the store's name; {name} the customer's.
// 'pending' is deliberately absent: the order-placed receipt (send-order-email)
// already covers it, so a second email would be noise.
export const DELIVERY_STATUS_COPY: Record<string, StatusCopy> = {
  confirmed: {
    subject: 'Your {store} order is confirmed 🌿',
    heading: 'Order Confirmed 🌿',
    message: 'Good news, {name} — your order has been confirmed and will be prepared shortly.',
  },
  preparing: {
    subject: 'Your {store} order is being prepared',
    heading: 'Preparing Your Order',
    message: '{name}, your order is being prepared with care. We’ll let you know the moment it’s on its way.',
  },
  out_for_delivery: {
    subject: 'Your {store} order is out for delivery 🚚',
    heading: 'Out for Delivery 🚚',
    message: '{name}, your order is on its way to you — follow your driver live on the tracking page. If you’re paying on delivery, have your payment ready.',
  },
  delivered: {
    subject: 'Your {store} order has been delivered',
    heading: 'Order Delivered ✅',
    message: 'Enjoy, {name}! Your order has been delivered. Thank you for choosing {store}.',
  },
  cancelled: {
    subject: 'Your {store} order has been cancelled',
    heading: 'Order Cancelled',
    message: '{name}, your order has been cancelled. If this wasn’t expected, please get in touch with us.',
  },
}

const COLLECT_STATUS_COPY: Record<string, StatusCopy> = {
  ...DELIVERY_STATUS_COPY,
  preparing: {
    subject: 'Your {store} order is being prepared',
    heading: 'Preparing Your Order',
    message: '{name}, your order is being prepared with care. We’ll email you the moment it’s ready to collect.',
  },
  out_for_delivery: {
    subject: 'Your {store} order is ready for collection',
    heading: 'Ready for Collection 🛍️',
    message: '{name}, your order is ready — come and collect it at the club. Bring your order number and ID. If you’re paying at the counter, cash or card is fine.',
  },
  delivered: {
    subject: 'Your {store} order has been collected',
    heading: 'Order Collected ✅',
    message: 'Enjoy, {name}! Your order has been collected. Thank you for choosing {store}.',
  },
}

export function statusCopyFor(mode: Fulfilment, status: string): StatusCopy | null {
  const map = mode === 'collect' ? COLLECT_STATUS_COPY : DELIVERY_STATUS_COPY
  return map[status] ?? null
}

// The values the orders_payment_method_check constraint allows are
// 'cash_on_delivery' / 'card_on_delivery' / 'eft' / 'online'; the short forms
// are kept for any legacy row.
export function paymentLabelFor(mode: Fulfilment, method?: string): string {
  const on = mode === 'collect' ? 'on collection' : 'on delivery'
  if (method === 'card' || method === 'card_on_delivery') return `Card ${on}`
  if (method === 'cash' || method === 'cash_on_delivery') return `Cash ${on}`
  if (method === 'eft') return 'EFT (bank transfer)'
  return mode === 'collect' ? 'On collection' : 'On delivery'
}

export function amountDueLabel(mode: Fulfilment, method?: string): string {
  if (method === 'eft') return 'Amount due by EFT'
  return mode === 'collect' ? 'Amount due on collection' : 'Amount due on delivery'
}

// The closing clause of the abandoned-cart reminder ("Pick up where you left
// off — …"). `from` is the store's free-delivery threshold, already formatted.
export function cartReminderLine(mode: Fulfilment, from: string, memberFreeDelivery: boolean): string {
  if (mode === 'collect') return 'order online and collect it at the club.'
  return memberFreeDelivery
    ? `delivery is free for members and on orders of ${from} or more.`
    : `delivery is free on orders of ${from} or more.`
}

/** What staff call a finished order: the stored status is 'delivered' either way. */
export function doneLabel(mode: Fulfilment): string {
  return mode === 'collect' ? 'Collected' : 'Delivered'
}

/** How a new member pays, for the owner's membership-application alert. */
export function membershipPayHint(mode: Fulfilment): string {
  return mode === 'collect'
    ? 'The applicant pays by EFT or at the counter.'
    : 'The applicant pays by EFT or with their next delivery.'
}
