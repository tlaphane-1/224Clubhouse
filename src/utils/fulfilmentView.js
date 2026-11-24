// Whether an order page should show where to collect it: only in a collect
// store, and only while the order is still open (not collected or cancelled).
// Old orders placed while the store delivered may carry an address; in a
// collect store that address is never shown.
export function showCollectFrom(order, collect) {
  return Boolean(collect) && !['delivered', 'cancelled'].includes(order?.status)
}

// Whether an order's delivery-fee line is shown. Collect orders have no fee,
// so the line is hidden; but an order placed before the store switched to
// collection may have been charged one, and its total must still add up.
export function showFeeLine(order, collect) {
  return !collect || (order?.shipping_fee ?? 0) > 0
}
