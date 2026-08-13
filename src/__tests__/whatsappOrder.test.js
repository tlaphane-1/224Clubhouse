/**
 * Pure-function coverage for WhatsApp ordering: message composition and
 * deep-link building. These rules decide what the store is asked to
 * prepare and for how much — exact-value assertions, no DOM, no Supabase.
 * Mirrors the Mosate restaurant app's basket.test.js.
 *
 * NOTE on currency strings: formatZAR uses Intl en-ZA, which renders
 * "R 120,00" (shown here with a plain space) — the separator after "R" (and between digit groups) is
 * a NON-BREAKING space (U+00A0) and the decimal separator is a comma.
 * The expected strings below spell that out with the \u00a0 escape so a
 * regular space typed by hand cannot silently pass/fail.
 */
import { describe, it, expect } from 'vitest'
import { buildWhatsAppLink, composeOrderMessage } from '../utils/whatsappOrder'

const NBSP = '\u00a0'

// Cart lines as CartContext holds them: full product objects with price in
// integer cents and a quantity. Extra product fields must be ignored.
const items = [
  { id: 'p1', name: 'OG Kush 3.5g', price: 12000, quantity: 1, stock_quantity: 10, slug: 'og-kush' },
  { id: 'p2', name: 'Pre-Roll Pack', price: 4500, quantity: 2, stock_quantity: 20, slug: 'pre-roll-pack' },
]

describe('composeOrderMessage', () => {
  it('composes the delivery variant with name and note exactly', () => {
    const msg = composeOrderMessage({
      items,
      mode: 'delivery',
      name: 'Thabo',
      address: '12 Trichardts Rd, Boksburg',
      note: 'call when you arrive',
    })

    expect(msg).toBe(
      [
        '*224 Clubhouse order*',
        '',
        `1× OG Kush 3.5g — R${NBSP}120,00`,
        `2× Pre-Roll Pack — R${NBSP}90,00`,
        '',
        `*Total: R${NBSP}210,00*`,
        '',
        '*Delivery* — 12 Trichardts Rd, Boksburg',
        'Name: Thabo',
        'Note: call when you arrive',
        '',
        'sent from 224clubhouse.web.app',
      ].join('\n')
    )
  })

  it('composes the minimal collection variant exactly — no address, name or note lines', () => {
    const msg = composeOrderMessage({
      items: items.slice(0, 1),
      mode: 'collection',
      name: '',
      address: '',
      note: '',
    })

    expect(msg).toBe(
      [
        '*224 Clubhouse order*',
        '',
        `1× OG Kush 3.5g — R${NBSP}120,00`,
        '',
        `*Total: R${NBSP}120,00*`,
        '',
        "*Collection* — I'll come pick it up",
        '',
        'sent from 224clubhouse.web.app',
      ].join('\n')
    )
  })

  it('totals in integer cents: line totals are price × qty, total is their sum', () => {
    const msg = composeOrderMessage({
      items: [
        { id: 'a', name: 'A', price: 3333, quantity: 3 }, // 9999 -> R 99,99
        { id: 'b', name: 'B', price: 100000, quantity: 2 }, // 200000 -> R 2 000,00
      ],
      mode: 'collection',
      name: '',
      address: '',
      note: '',
    })

    expect(msg).toContain(`3× A — R${NBSP}99,99`)
    expect(msg).toContain(`2× B — R${NBSP}2${NBSP}000,00`)
    // 9999 + 200000 = 209999 cents
    expect(msg).toContain(`*Total: R${NBSP}2${NBSP}099,99*`)
  })
})

describe('buildWhatsAppLink', () => {
  it('strips everything but digits from the number', () => {
    expect(buildWhatsAppLink('+27 82 123 4567')).toBe('https://wa.me/27821234567')
  })

  it('URL-encodes the prefilled text, including × and — and newlines', () => {
    expect(buildWhatsAppLink('27821234567', '1× Pre-Roll — hold\nthanks')).toBe(
      'https://wa.me/27821234567?text=1%C3%97%20Pre-Roll%20%E2%80%94%20hold%0Athanks'
    )
  })

  it('returns a bare link when no text is given', () => {
    expect(buildWhatsAppLink('27821234567')).toBe('https://wa.me/27821234567')
    expect(buildWhatsAppLink('27821234567', '')).toBe('https://wa.me/27821234567')
  })
})
