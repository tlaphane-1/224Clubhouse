/**
 * One-tap WhatsApp shares for staff (owner decision 2026-10-08, instead of
 * automated group alerts). Every message is SENT BY A PERSON: the link opens
 * WhatsApp with the text filled in, they pick the group/driver and tap Send.
 * That keeps the club inside WhatsApp's rules (no automation, no Business API
 * review) and puts no number at risk.
 *
 * Pure functions — exact-string testable. WhatsApp renders *bold*.
 */
import { buildWhatsAppLink } from './whatsappOrder'
import { formatZAR } from './formatCurrency'
import { lineName } from './variants'
import { paymentLabel } from './orderStatus'

const SITE = 'https://224clubhouse.store'

/** SA numbers as WhatsApp wants them: digits, country code, no leading 0. */
export function toWhatsAppNumber(phone) {
  let d = String(phone ?? '').replace(/\D/g, '')
  if (!d) return ''
  if (d.startsWith('00')) d = d.slice(2)
  if (d.startsWith('0')) d = `27${d.slice(1)}`
  return d
}

/** Opens WhatsApp's chat picker (choose the staff group) with `text`. */
export const shareLink = (text) => buildWhatsAppLink('', text)

/** Opens a chat with `phone` with `text` filled in. */
export const chatLink = (phone, text) => buildWhatsAppLink(toWhatsAppNumber(phone), text)

function addressLine(a = {}) {
  return [a.street, a.apartment, a.city, a.postalCode].filter(Boolean).join(', ')
}

const mapsLink = (a) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addressLine(a))}`

function collectLine(order) {
  if (order.payment_method === 'eft') {
    return order.paid_at ? 'Paid by EFT — collect nothing' : 'EFT NOT paid yet — do not deliver'
  }
  return `Collect *${formatZAR(order.total)}* (${paymentLabel(order.payment_method)})`
}

const itemsBlock = (items = []) => items.map(i => `• ${i.quantity}× ${lineName(i)}`).join('\n')

/** New / open order, for the staff group. */
export function orderMessage(order) {
  return [
    `🛒 *Order ${order.order_number}* — ${formatZAR(order.total)} (${paymentLabel(order.payment_method)})`,
    `${order.customer_name} · ${order.customer_phone ?? ''}`,
    addressLine(order.shipping_address),
    '',
    itemsBlock(order.items),
    '',
    collectLine(order),
    `${SITE}/admin/orders`,
  ].join('\n')
}

/** EFT proof uploaded — check FNB before marking it paid. */
export function eftCheckMessage(order) {
  return [
    `🧾 *EFT to check* — ${order.order_number}, ${formatZAR(order.total)}`,
    `Reference should be: *${order.customer_name}*`,
    order.payment_proof_uploaded_at ? 'Customer uploaded proof of payment (check FNB — proofs can be faked).' : 'No proof uploaded yet.',
    `${SITE}/admin/orders?filter=eft`,
  ].join('\n')
}

/** Job sheet sent straight to the assigned driver. */
export function driverJobMessage(order, driverName) {
  const first = (driverName ?? '').split(' ')[0]
  return [
    `🚚 ${first ? `Hi ${first}, ` : ''}new delivery: *${order.order_number}*`,
    '',
    `*${order.customer_name}* · ${order.customer_phone ?? ''}`,
    addressLine(order.shipping_address),
    `📍 ${mapsLink(order.shipping_address)}`,
    '',
    itemsBlock(order.items),
    '',
    collectLine(order),
    '',
    `Open your driver app to start it: ${SITE}/driver`,
  ].join('\n')
}

/** Delivery update for the staff group. */
export function deliveryUpdateMessage(order, driverName) {
  const who = driverName || 'The driver'
  return order.status === 'delivered'
    ? `✅ *${order.order_number}* delivered to ${order.customer_name}${driverName ? ` by ${driverName}` : ''}`
    : `🚚 ${who} is on the way with *${order.order_number}* for ${order.customer_name}`
}

/** Today-so-far summary for the staff group (from admin_daily_summary). */
export function dailySummaryMessage(s) {
  const lines = [
    `☀️ *224 summary — ${s.day}*`,
    `👀 ${s.visitors} visitors · ${s.page_views} page views · ${s.new_accounts} new accounts`,
    `🛒 ${s.orders} orders · ${formatZAR(s.booked_cents)} booked · ${s.delivered} delivered (${formatZAR(s.delivered_cents)})`,
    '',
    '*Waiting*',
    `🧾 EFT: ${s.eft_proof} proof${s.eft_proof === 1 ? '' : 's'} to check, ${s.eft_awaiting} awaiting payment`,
    `⭐ ${s.reviews_pending} review${s.reviews_pending === 1 ? '' : 's'} · 👑 ${s.memberships_pending} membership application${s.memberships_pending === 1 ? '' : 's'}`,
  ]
  if (s.low_stock?.length) {
    lines.push('', '⚠️ *Low stock*', ...s.low_stock.map(l => `• ${l.name}: ${l.left === 0 ? 'SOLD OUT' : `${l.left} left`}`))
  }
  lines.push('', `${SITE}/admin/dashboard`)
  return lines.join('\n')
}
