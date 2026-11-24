import { describe, it, expect } from 'vitest'
import { shippingFeeFor } from './shipping'

describe('shippingFeeFor', () => {
  it('collect mode never charges a fee', () => {
    expect(shippingFeeFor(10000, false, 'collect')).toBe(0)
  })

  it('delivery mode charges R30 under R500 and nothing from R500 or for members', () => {
    expect(shippingFeeFor(10000, false, 'delivery')).toBe(3000)
    expect(shippingFeeFor(50000, false, 'delivery')).toBe(0)
    expect(shippingFeeFor(10000, true, 'delivery')).toBe(0)
  })
})
