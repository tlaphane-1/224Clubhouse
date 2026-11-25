// Stock-take helpers for the counter tablet (part 2b). The reasons must match
// the check constraint on stock_adjustments.reason.

export const STOCK_REASONS = [
  { value: 'count', label: 'Stock count' },
  { value: 'received', label: 'Delivery received' },
  { value: 'damaged', label: 'Damaged / lost' },
  { value: 'other', label: 'Other' },
]

export function reasonLabel(value) {
  return STOCK_REASONS.find(r => r.value === value)?.label ?? value
}

/** "+3", "−2" or "0" between the old and new quantity. */
export function stockDelta(oldQty, newQty) {
  const d = newQty - oldQty
  if (d === 0) return '0'
  return d > 0 ? `+${d}` : `−${Math.abs(d)}`
}

/** A typed count as a whole number 0–100000, or null. */
export function parseCount(text) {
  const t = String(text ?? '').trim()
  if (!/^\d+$/.test(t)) return null
  const n = Number(t)
  return n <= 100000 ? n : null
}
