import { describe, it, expect } from 'vitest'
import { showCollectFrom, showFeeLine } from './fulfilmentView'

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

describe('showFeeLine', () => {
  it('collect: hidden for collection orders (fee 0)', () => {
    expect(showFeeLine({ shipping_fee: 0 }, true)).toBe(false)
  })

  it('collect: shown on an old order that was charged delivery, so the total adds up', () => {
    expect(showFeeLine({ shipping_fee: 3000 }, true)).toBe(true)
  })

  it('delivery store: always shown (free shows as FREE)', () => {
    expect(showFeeLine({ shipping_fee: 0 }, false)).toBe(true)
  })
})
