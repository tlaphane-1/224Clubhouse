import { describe, it, expect } from 'vitest'
import { labelsFor } from './orderStatus'

const DELIVERY_STATUS = {
  pending: 'Order Placed',
  confirmed: 'Confirmed',
  preparing: 'Preparing',
  out_for_delivery: 'Out for Delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  paid: 'Paid',
  processing: 'Processing',
  shipped: 'Shipped',
}
const DELIVERY_PAYMENT = {
  cash_on_delivery: 'Cash on Delivery',
  card_on_delivery: 'Card on Delivery',
  eft: 'EFT (Bank Transfer)',
  online: 'Paid Online',
}

describe('labelsFor', () => {
  it('delivery mode keeps today\'s labels exactly', () => {
    expect(labelsFor('delivery').status).toEqual(DELIVERY_STATUS)
    expect(labelsFor('delivery').payment).toEqual(DELIVERY_PAYMENT)
  })

  it('collect mode relabels the delivery steps as collection', () => {
    const { status } = labelsFor('collect')
    expect(status.out_for_delivery).toBe('Ready for Collection')
    expect(status.delivered).toBe('Collected')
    expect(status.preparing).toBe('Preparing')
  })

  it('collect mode relabels pay-on-delivery as pay-on-collection; EFT unchanged', () => {
    const { payment } = labelsFor('collect')
    expect(payment.cash_on_delivery).toBe('Cash on Collection')
    expect(payment.card_on_delivery).toBe('Card on Collection')
    expect(payment.eft).toBe('EFT (Bank Transfer)')
  })
})
