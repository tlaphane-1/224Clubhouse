import { describe, it, expect } from 'vitest'
import {
  toWhatsAppNumber, shareLink, chatLink, orderMessage, eftCheckMessage,
  driverJobMessage, deliveryUpdateMessage, dailySummaryMessage,
} from './staffWhatsApp'

const order = {
  order_number: '224-ABC123',
  total: 18000,
  payment_method: 'cash_on_delivery',
  customer_name: 'Thabo Mokoena',
  customer_phone: '082 123 4567',
  shipping_address: { street: '12 Main Rd', city: 'Boksburg', postalCode: '1459' },
  items: [{ name: 'OG Kush', variant_label: '3.5g', quantity: 2 }],
  status: 'confirmed',
}

describe('toWhatsAppNumber', () => {
  it('turns SA local numbers into international digits', () => {
    expect(toWhatsAppNumber('082 123 4567')).toBe('27821234567')
    expect(toWhatsAppNumber('+27 82 123 4567')).toBe('27821234567')
    expect(toWhatsAppNumber('0027821234567')).toBe('27821234567')
    expect(toWhatsAppNumber('')).toBe('')
  })
})

describe('links', () => {
  it('share opens the chat picker; chat targets the number', () => {
    expect(shareLink('hi')).toBe('https://wa.me/?text=hi')
    expect(chatLink('082 123 4567', 'hi there')).toBe('https://wa.me/27821234567?text=hi%20there')
  })
})

describe('messages', () => {
  it('order message has items, cash to collect and the admin link', () => {
    const m = orderMessage(order)
    expect(m).toContain('*Order 224-ABC123*')
    expect(m).toContain('• 2× OG Kush — 3.5g')
    expect(m).toContain('Collect *R')
    expect(m).toContain('/admin/orders')
  })

  it('EFT states are explicit for drivers', () => {
    const unpaid = { ...order, payment_method: 'eft', paid_at: null }
    expect(driverJobMessage(unpaid, 'Sipho Dube')).toContain('EFT NOT paid yet')
    expect(driverJobMessage({ ...unpaid, paid_at: '2026-10-08' }, 'Sipho')).toContain('collect nothing')
  })

  it('driver job sheet greets the driver and links maps + the portal', () => {
    const m = driverJobMessage(order, 'Sipho Dube')
    expect(m.startsWith('🚚 Hi Sipho, new delivery: *224-ABC123*')).toBe(true)
    expect(m).toContain('https://www.google.com/maps/dir/?api=1&destination=12%20Main%20Rd%2C%20Boksburg%2C%201459')
    expect(m).toContain('/driver')
  })

  it('EFT check names the expected reference', () => {
    expect(eftCheckMessage({ ...order, payment_method: 'eft' })).toContain('Reference should be: *Thabo Mokoena*')
  })

  it('delivery update', () => {
    expect(deliveryUpdateMessage({ ...order, status: 'delivered' }, 'Sipho')).toBe('✅ *224-ABC123* delivered to Thabo Mokoena by Sipho')
  })

  it('daily summary includes low stock only when there is some', () => {
    const base = { day: '2026-10-08', visitors: 3, page_views: 9, new_accounts: 1, orders: 2, booked_cents: 20000, delivered: 1, delivered_cents: 6000, eft_proof: 0, eft_awaiting: 1, reviews_pending: 0, memberships_pending: 2, low_stock: [] }
    expect(dailySummaryMessage(base)).not.toContain('Low stock')
    expect(dailySummaryMessage({ ...base, low_stock: [{ name: 'Gelato', left: 0 }] })).toContain('• Gelato: SOLD OUT')
  })
})
