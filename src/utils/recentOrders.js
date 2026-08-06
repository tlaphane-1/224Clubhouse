/**
 * Remembers the orders placed from this browser, so a customer can get back to
 * Track Order without having written down an order number.
 *
 * Why local storage and not an account lookup: orders are anonymous — there is no
 * customer login, and `orders` is admin-only under RLS with `get_order_tracking`
 * deliberately requiring order number AND email so nobody can enumerate other
 * people's orders by email alone. Storing the pair on the device that placed the
 * order keeps that boundary intact.
 *
 * Limitation: this is per-browser. Clearing site data, or ordering on a phone and
 * tracking on a laptop, still needs the order number.
 */

const KEY = '224:recent-orders'
const MAX = 10

function read() {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter(o => o?.orderNumber && o?.email) : []
  } catch {
    // Private mode, disabled storage, or corrupt JSON — never break checkout for this.
    return []
  }
}

function write(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)))
  } catch {
    /* non-fatal */
  }
}

/** Orders placed from this browser, newest first. */
export function getRecentOrders() {
  return read().sort((a, b) => (b.placedAt || '').localeCompare(a.placedAt || ''))
}

/** Record an order after a successful checkout. Re-placing the same number de-dupes. */
export function rememberOrder({ orderNumber, email, total, itemCount }) {
  if (!orderNumber || !email) return
  const entry = {
    orderNumber: String(orderNumber).toUpperCase(),
    email: String(email).trim(),
    total: total ?? null,
    itemCount: itemCount ?? null,
    placedAt: new Date().toISOString(),
  }
  write([entry, ...read().filter(o => o.orderNumber !== entry.orderNumber)])
}

/** Drop one remembered order (e.g. a shared/public computer). */
export function forgetOrder(orderNumber) {
  write(read().filter(o => o.orderNumber !== orderNumber))
}

/** The most recent order placed here, or null — used to recover a refreshed confirmation page. */
export function getLastOrder() {
  return getRecentOrders()[0] ?? null
}
