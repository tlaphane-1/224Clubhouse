// Whether an order page should show where to collect it: only in a collect
// store, and only while the order is still open (not collected or cancelled).
// Old orders placed while the store delivered may carry an address; in a
// collect store that address is never shown.
export function showCollectFrom(order, collect) {
  return Boolean(collect) && !['delivered', 'cancelled'].includes(order?.status)
}
