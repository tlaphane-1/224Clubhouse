import { describe, it, expect } from 'vitest'
import { showCollectFrom } from './fulfilmentView'

describe('showCollectFrom', () => {
  it('collect: an open order shows where to collect, even an old one with an address', () => {
    expect(showCollectFrom({ status: 'preparing', shipping_address: { street: '1 Old St' } }, true)).toBe(true)
    expect(showCollectFrom({ status: 'out_for_delivery' }, true)).toBe(true)
  })

  it('collect: a collected or cancelled order does not', () => {
    expect(showCollectFrom({ status: 'delivered' }, true)).toBe(false)
    expect(showCollectFrom({ status: 'cancelled' }, true)).toBe(false)
  })

  it('delivery store: never', () => {
    expect(showCollectFrom({ status: 'preparing' }, false)).toBe(false)
  })
})
