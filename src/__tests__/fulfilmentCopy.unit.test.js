import { describe, it, expect } from 'vitest'
import {
  statusCopyFor, paymentLabelFor, amountDueLabel, DELIVERY_STATUS_COPY, cartReminderLine, doneLabel, membershipPayHint,
} from '../../supabase/functions/_shared/fulfilmentCopy.ts'

describe('statusCopyFor', () => {
  it('delivery: unchanged copy for every status', () => {
    for (const status of Object.keys(DELIVERY_STATUS_COPY)) {
      expect(statusCopyFor('delivery', status)).toEqual(DELIVERY_STATUS_COPY[status])
    }
    expect(DELIVERY_STATUS_COPY.out_for_delivery.subject).toBe('Your {store} order is out for delivery 🚚')
  })

  it('collect: ready for collection, with no driver or delivery wording', () => {
    const c = statusCopyFor('collect', 'out_for_delivery')
    expect(c.subject).toBe('Your {store} order is ready for collection')
    expect(c.message).toMatch(/collect/i)
    expect(`${c.subject} ${c.heading} ${c.message}`).not.toMatch(/driver|deliver/i)
  })

  it('collect: delivered reads as collected', () => {
    expect(statusCopyFor('collect', 'delivered').heading).toBe('Order Collected ✅')
  })

  it('collect: no status email copy mentions delivery or drivers', () => {
    for (const status of Object.keys(DELIVERY_STATUS_COPY)) {
      const c = statusCopyFor('collect', status)
      expect(`${c.subject} ${c.heading} ${c.message}`).not.toMatch(/driver|deliver/i)
    }
  })

  it('pending has no status email in either mode', () => {
    expect(statusCopyFor('delivery', 'pending')).toBeNull()
    expect(statusCopyFor('collect', 'pending')).toBeNull()
  })
})

describe('payment wording', () => {
  it('collect', () => {
    expect(paymentLabelFor('collect', 'cash_on_delivery')).toBe('Cash on collection')
    expect(paymentLabelFor('collect', 'card_on_delivery')).toBe('Card on collection')
    expect(amountDueLabel('collect', 'cash_on_delivery')).toBe('Amount due on collection')
    expect(amountDueLabel('collect', 'eft')).toBe('Amount due by EFT')
  })

  it('delivery: unchanged', () => {
    expect(paymentLabelFor('delivery', 'cash_on_delivery')).toBe('Cash on delivery')
    expect(paymentLabelFor('delivery', 'card')).toBe('Card on delivery')
    expect(amountDueLabel('delivery', 'card_on_delivery')).toBe('Amount due on delivery')
  })
})

describe('cartReminderLine', () => {
  it('delivery: unchanged free-delivery wording', () => {
    expect(cartReminderLine('delivery', 'R500', false)).toBe('delivery is free on orders of R500 or more.')
    expect(cartReminderLine('delivery', 'R500', true)).toBe('delivery is free for members and on orders of R500 or more.')
  })

  it('collect: promises collection, never delivery', () => {
    const line = cartReminderLine('collect', 'R500', true)
    expect(line).toMatch(/collect/i)
    expect(line).not.toMatch(/deliver/i)
  })
})

describe('staff wording', () => {
  it('done orders are "Delivered" or "Collected"', () => {
    expect(doneLabel('delivery')).toBe('Delivered')
    expect(doneLabel('collect')).toBe('Collected')
  })
  it('membership payment hint matches how the store works', () => {
    expect(membershipPayHint('delivery')).toBe('The applicant pays by EFT or with their next delivery.')
    expect(membershipPayHint('collect')).toBe('The applicant pays by EFT or at the counter.')
  })
})
