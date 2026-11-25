import { describe, it, expect } from 'vitest'
import { memberCardUrl, parseMemberCode, requestToLines, firstName, IDLE_MS } from './table'

const HOSTS = ['explosive420.co.za', 'www.explosive420.co.za']
const T = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'

describe('member card codes', () => {
  it('the card QR is the site address plus /m/<token>', () => {
    expect(memberCardUrl('https://explosive420.co.za', T)).toBe(`https://explosive420.co.za/m/${T}`)
  })
  it('reads our own cards back', () => {
    expect(parseMemberCode(`https://www.explosive420.co.za/m/${T}`, HOSTS)).toBe(T)
  })
  it('anything else is not a card', () => {
    expect(parseMemberCode(`https://evil.example/m/${T}`, HOSTS)).toBeNull()
    expect(parseMemberCode('https://explosive420.co.za/store/gelato', HOSTS)).toBeNull()
    expect(parseMemberCode('https://explosive420.co.za/m/not-a-uuid', HOSTS)).toBeNull()
    expect(parseMemberCode(`http://explosive420.co.za/m/${T}`, HOSTS)).toBeNull()
    expect(parseMemberCode('', HOSTS)).toBeNull()
  })
})

describe('requestToLines', () => {
  it('turns a table order into cart lines, skipping what can no longer be sold', () => {
    const items = [
      { id: 'p1', variant_id: null, quantity: 2, name: 'Gelato', label: null, price: 15000, stock: 5, available: true },
      { id: 'p2', variant_id: 'v1', quantity: 5, name: 'OG', label: '3.5g', price: 40000, stock: 3, available: true },
      { id: 'p3', variant_id: null, quantity: 1, name: 'Gone', label: null, price: 1, stock: 0, available: true },
      { id: 'p4', variant_id: null, quantity: 1, name: 'Off', label: null, price: 1, stock: 9, available: false },
    ]
    expect(requestToLines(items)).toEqual({
      lines: [
        { key: 'p1', productId: 'p1', variantId: null, name: 'Gelato', label: null, price: 15000, stock: 5, quantity: 2 },
        { key: 'p2:v1', productId: 'p2', variantId: 'v1', name: 'OG', label: '3.5g', price: 40000, stock: 3, quantity: 3 },
      ],
      skipped: ['Gone', 'Off'],
    })
  })
})

describe('firstName', () => {
  it('first word, or a friendly fallback', () => {
    expect(firstName('Thabo Mokoena')).toBe('Thabo')
    expect(firstName('  ')).toBe('there')
    expect(firstName(null)).toBe('there')
  })
})

describe('IDLE_MS', () => {
  it('is 3 minutes', () => {
    expect(IDLE_MS).toBe(180000)
  })
})
