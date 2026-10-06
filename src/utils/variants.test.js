import { describe, it, expect } from 'vitest'
import {
  sortedVariants, hasVariants, purchasableVariants, variantPriceRange,
  toCartItem, cartLineKey, lineName,
} from './variants'
import { cartReducer } from '../context/cartReducer'

const product = {
  id: 'p1', name: 'OG Kush', price: 12000, stock_quantity: 9, slug: 'og-kush',
  product_variants: [
    { id: 'v7', label: '7g', price: 40000, stock_quantity: 2, is_available: true, sort_order: 2 },
    { id: 'v1', label: '1g', price: 12000, stock_quantity: 5, is_available: true, sort_order: 0 },
    { id: 'v35', label: '3.5g', price: 25000, stock_quantity: 2, is_available: false, sort_order: 1 },
  ],
}

describe('variants helpers', () => {
  it('sorts options by sort_order', () => {
    expect(sortedVariants(product).map(v => v.id)).toEqual(['v1', 'v35', 'v7'])
  })

  it('hasVariants is true even when every option is switched off (server requires a choice)', () => {
    const allOff = { ...product, product_variants: product.product_variants.map(v => ({ ...v, is_available: false })) }
    expect(hasVariants(allOff)).toBe(true)
    expect(purchasableVariants(allOff)).toEqual([])
    expect(variantPriceRange(allOff)).toBeNull()
  })

  it('plain products have no options', () => {
    expect(hasVariants({ id: 'x' })).toBe(false)
    expect(hasVariants({ id: 'x', product_variants: [] })).toBe(false)
  })

  it('price range covers available options only', () => {
    expect(variantPriceRange(product)).toEqual({ min: 12000, max: 40000 })
  })

  it('toCartItem takes price and stock from the option and drops the option list', () => {
    const item = toCartItem(product, product.product_variants[0])
    expect(item).toMatchObject({ id: 'p1', variant_id: 'v7', variant_label: '7g', price: 40000, stock_quantity: 2 })
    expect(item.product_variants).toBeUndefined()
    expect(toCartItem(product).variant_id).toBeUndefined()
  })

  it('lineName and cartLineKey', () => {
    expect(lineName({ name: 'OG Kush', variant_label: '1g' })).toBe('OG Kush — 1g')
    expect(lineName({ name: 'Lighter' })).toBe('Lighter')
    expect(cartLineKey({ id: 'p1', variant_id: 'v1' })).toBe('p1:v1')
    expect(cartLineKey({ id: 'p1' })).toBe('p1')
  })
})

describe('cart reducer with options', () => {
  const one = { ...toCartItem(product, product.product_variants[1]), quantity: 1 }
  const seven = { ...toCartItem(product, product.product_variants[0]), quantity: 1 }

  it('two options of the same product are separate lines', () => {
    let state = cartReducer([], { type: 'ADD_ITEM', item: one })
    state = cartReducer(state, { type: 'ADD_ITEM', item: seven })
    expect(state).toHaveLength(2)
  })

  it('adding the same option again merges and clamps to that option\'s stock', () => {
    let state = cartReducer([], { type: 'ADD_ITEM', item: seven })
    state = cartReducer(state, { type: 'ADD_ITEM', item: { ...seven, quantity: 5 } })
    expect(state).toHaveLength(1)
    expect(state[0].quantity).toBe(2)
  })

  it('remove and update target one line by key', () => {
    let state = [one, seven]
    state = cartReducer(state, { type: 'UPDATE_QUANTITY', key: cartLineKey(one), quantity: 3 })
    expect(state.find(i => i.variant_id === 'v1').quantity).toBe(3)
    expect(state.find(i => i.variant_id === 'v7').quantity).toBe(1)
    state = cartReducer(state, { type: 'REMOVE_ITEM', key: cartLineKey(seven) })
    expect(state.map(i => i.variant_id)).toEqual(['v1'])
  })

  it('carts saved before options existed still work (key = product id)', () => {
    const legacy = [{ id: 'p9', price: 5000, quantity: 1, stock_quantity: 4 }]
    const state = cartReducer(legacy, { type: 'UPDATE_QUANTITY', key: 'p9', quantity: 2 })
    expect(state[0].quantity).toBe(2)
  })
})
