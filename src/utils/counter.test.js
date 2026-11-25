import { describe, it, expect } from 'vitest'
import {
  labelUrl, parseLabelCode, counterCartReducer, cartTotal, toSaleItems, memberBadge,
  labelSheetItems, saleBlockers, productLine, pickerOptions, lineFromScan,
} from './counter'

const SITE = 'https://explosive420.co.za'
const HOSTS = ['explosive420.co.za', 'www.explosive420.co.za', 'explosive420.web.app']

describe('labelUrl / parseLabelCode', () => {
  it('a product label is its store page; an option label adds ?v=', () => {
    expect(labelUrl(SITE, { slug: 'gelato' })).toBe('https://explosive420.co.za/store/gelato')
    expect(labelUrl(SITE, { slug: 'gelato' }, { id: 'v1' })).toBe('https://explosive420.co.za/store/gelato?v=v1')
  })

  it('reads our own labels back, from any of the store hosts', () => {
    expect(parseLabelCode('https://explosive420.co.za/store/gelato', HOSTS)).toEqual({ slug: 'gelato', variantId: null })
    expect(parseLabelCode('https://www.explosive420.co.za/store/gelato?v=v1', HOSTS)).toEqual({ slug: 'gelato', variantId: 'v1' })
  })

  it('anything else is not one of our labels', () => {
    expect(parseLabelCode('https://evil.example/store/gelato', HOSTS)).toBeNull()
    expect(parseLabelCode('https://explosive420.co.za/products/gelato', HOSTS)).toBeNull()
    expect(parseLabelCode('just some text', HOSTS)).toBeNull()
    expect(parseLabelCode('', HOSTS)).toBeNull()
  })
})

const line = (over = {}) => ({ key: 'p1', productId: 'p1', variantId: null, name: 'Gelato', label: null, price: 15000, stock: 3, ...over })

describe('counterCartReducer', () => {
  it('adding the same item again increases the quantity', () => {
    let s = counterCartReducer({ lines: [] }, { type: 'add', line: line() })
    s = counterCartReducer(s, { type: 'add', line: line() })
    expect(s.lines).toHaveLength(1)
    expect(s.lines[0].quantity).toBe(2)
  })

  it('never goes above stock', () => {
    let s = { lines: [] }
    for (let i = 0; i < 5; i++) s = counterCartReducer(s, { type: 'add', line: line() })
    expect(s.lines[0].quantity).toBe(3)
    s = counterCartReducer(s, { type: 'setQty', key: 'p1', quantity: 10 })
    expect(s.lines[0].quantity).toBe(3)
  })

  it('an item with no stock is not added', () => {
    const s = counterCartReducer({ lines: [] }, { type: 'add', line: line({ stock: 0 }) })
    expect(s.lines).toHaveLength(0)
  })

  it('load replaces the cart with a table order', () => {
    const s = counterCartReducer({ lines: [{ ...line(), quantity: 1 }] }, { type: 'load', lines: [{ ...line({ key: 'x', productId: 'x' }), quantity: 2 }] })
    expect(s.lines.map(l => [l.key, l.quantity])).toEqual([['x', 2]])
  })

  it('quantity 0 removes the line; clear empties the cart', () => {
    let s = counterCartReducer({ lines: [] }, { type: 'add', line: line() })
    s = counterCartReducer(s, { type: 'setQty', key: 'p1', quantity: 0 })
    expect(s.lines).toHaveLength(0)
    s = counterCartReducer(counterCartReducer(s, { type: 'add', line: line() }), { type: 'clear' })
    expect(s.lines).toHaveLength(0)
  })
})

describe('cartTotal / toSaleItems', () => {
  const lines = [{ ...line(), quantity: 2 }, { ...line({ key: 'p2:v9', productId: 'p2', variantId: 'v9', price: 40000 }), quantity: 1 }]
  it('totals in cents', () => {
    expect(cartTotal(lines)).toBe(70000)
  })
  it('sends only ids, options and quantities (never prices)', () => {
    expect(toSaleItems(lines)).toEqual([{ id: 'p1', quantity: 2 }, { id: 'p2', variant_id: 'v9', quantity: 1 }])
  })
})

describe('memberBadge', () => {
  it('labels each status', () => {
    expect(memberBadge('active').label).toBe('Member')
    expect(memberBadge('pending').label).toBe('Membership pending')
    expect(memberBadge('expired').label).toBe('Membership expired')
    expect(memberBadge('none').label).toBe('Not a member')
    expect(memberBadge(undefined).label).toBe('Not a member')
  })
})

describe('labelSheetItems', () => {
  it('one label per option, or per product without options; unavailable skipped', () => {
    const products = [
      { id: 'a', name: 'Gelato', slug: 'gelato', price: 15000, is_available: true, product_variants: [] },
      { id: 'b', name: 'OG', slug: 'og', price: 10000, is_available: true, product_variants: [
        { id: 'v1', label: '3.5g', price: 40000, is_available: true },
        { id: 'v2', label: '7g', price: 75000, is_available: false },
      ] },
      { id: 'c', name: 'Gone', slug: 'gone', price: 1, is_available: false, product_variants: [] },
    ]
    expect(labelSheetItems(products, SITE)).toEqual([
      { key: 'a', name: 'Gelato', option: null, price: 15000, url: 'https://explosive420.co.za/store/gelato' },
      { key: 'b:v1', name: 'OG', option: '3.5g', price: 40000, url: 'https://explosive420.co.za/store/og?v=v1' },
    ])
  })
})

describe('saleBlockers', () => {
  const ready = { customer: { name: 'A', phone: '1' }, lines: [{ ...line(), quantity: 1 }], method: 'cash_on_delivery', idChecked: true, onShift: true }
  it('nothing blocks a ready sale', () => {
    expect(saleBlockers(ready)).toEqual([])
  })
  it('lists what is missing, in order', () => {
    expect(saleBlockers({ customer: null, lines: [], method: null, idChecked: false, onShift: false })).toEqual([
      'Start your shift first',
      'Choose a customer or walk-in',
      'Add at least one item',
      'Choose cash or card',
      'Tick that you checked their ID',
    ])
  })
})

describe('productLine', () => {
  it('a plain product line takes the product price and stock', () => {
    expect(productLine({ id: 'p', name: 'Gelato', price: 15000, stock_quantity: 4 })).toEqual({
      key: 'p', productId: 'p', variantId: null, name: 'Gelato', label: null, price: 15000, stock: 4,
    })
  })
  it('an option line takes the option price and stock', () => {
    expect(productLine({ id: 'p', name: 'OG', price: 1, stock_quantity: 9 }, { id: 'v', label: '7g', price: 75000, stock_quantity: 2 })).toEqual({
      key: 'p:v', productId: 'p', variantId: 'v', name: 'OG', label: '7g', price: 75000, stock: 2,
    })
  })
})

const og = { id: 'p', slug: 'og', name: 'OG', price: 1, stock_quantity: 9, product_variants: [
  { id: 'v1', label: '3.5g', price: 40000, stock_quantity: 2, is_available: true },
  { id: 'v2', label: '7g', price: 75000, stock_quantity: 2, is_available: false },
] }

describe('pickerOptions', () => {
  it('a product without options is sold as itself', () => {
    expect(pickerOptions({ product_variants: [] })).toEqual({ kind: 'plain', variants: [] })
  })
  it('only available options are offered', () => {
    expect(pickerOptions(og)).toEqual({ kind: 'options', variants: [og.product_variants[0]] })
  })
  it('a product whose options are all unavailable cannot be sold', () => {
    expect(pickerOptions({ product_variants: [{ ...og.product_variants[1] }] })).toEqual({ kind: 'unavailable', variants: [] })
  })
})

describe('lineFromScan', () => {
  const products = [og, { id: 'g', slug: 'gelato', name: 'Gelato', price: 15000, stock_quantity: 3, product_variants: [] }]
  it('a plain product label adds the product', () => {
    expect(lineFromScan(products, { slug: 'gelato', variantId: null })).toEqual({ line: productLine(products[1]) })
  })
  it('an available option label adds that option', () => {
    expect(lineFromScan(products, { slug: 'og', variantId: 'v1' })).toEqual({ line: productLine(og, og.product_variants[0]) })
  })
  it('an unavailable option is refused', () => {
    expect(lineFromScan(products, { slug: 'og', variantId: 'v2' })).toEqual({ error: 'OG 7g is not for sale right now' })
  })
  it('a product label for a product with options asks for the option label', () => {
    expect(lineFromScan(products, { slug: 'og', variantId: null })).toEqual({ error: 'Scan the option label for OG' })
  })
  it('unknown codes are not ours', () => {
    expect(lineFromScan(products, null)).toEqual({ error: 'Not one of our labels' })
    expect(lineFromScan(products, { slug: 'nope', variantId: null })).toEqual({ error: 'Not one of our labels' })
  })
})
