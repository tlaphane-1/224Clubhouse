/**
 * WhatsApp ordering as pure functions, separate from React.
 *
 * The physical store already takes orders on WhatsApp, so this is a
 * first-class order channel next to the account-required COD checkout —
 * not a fallback. Ported from the Mosate restaurant app's basket.js.
 *
 * Kept dependency-free (formatZAR is pure) so message composition and
 * link building are exact-string testable with no DOM and no Supabase.
 *
 * The WhatsApp number comes from VITE_WHATSAPP_NUMBER, read at the
 * component level (WhatsAppOrderPanel) — never inside these utils.
 */
import { formatZAR } from './formatCurrency'

/**
 * Digits-only number -> wa.me deep link. An optional `text` prefills the
 * message (the cart uses this to hand over a composed order).
 */
export function buildWhatsAppLink(number, text) {
  const base = `https://wa.me/${String(number ?? '').replace(/\D/g, '')}`
  return text ? `${base}?text=${encodeURIComponent(text)}` : base
}

/**
 * The order as it lands on the store's phone. WhatsApp renders *bold*,
 * and staff read this off a small screen — so: one line per item with the
 * line total, the payable total set off in bold, fulfilment before the
 * customer details they will need to act on it.
 *
 * `items` are cart lines from CartContext: { name, price, quantity } with
 * price in integer cents (ZAR). All products are priced — there is no
 * "priced in store" concept here, unlike Mosate.
 */
export function composeOrderMessage({ items, mode, name, address, note }) {
  const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0)

  const out = ['*224 Clubhouse order*', '']

  for (const i of items) {
    out.push(`${i.quantity}× ${i.name} — ${formatZAR(i.price * i.quantity)}`)
  }

  out.push('', `*Total: ${formatZAR(subtotal)}*`, '')

  if (mode === 'delivery') {
    out.push(`*Delivery* — ${address}`)
  } else {
    out.push("*Collection* — I'll come pick it up")
  }
  if (name) out.push(`Name: ${name}`)
  if (note) out.push(`Note: ${note}`)

  out.push('', 'sent from 224clubhouse.web.app')
  return out.join('\n')
}
