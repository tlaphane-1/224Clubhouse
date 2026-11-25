import { describe, it, expect } from 'vitest'
import { STOCK_REASONS, reasonLabel, stockDelta, parseCount } from './stocktake'

describe('stock reasons', () => {
  it('match the server list, with plain labels', () => {
    expect(STOCK_REASONS.map(r => r.value)).toEqual(['count', 'received', 'damaged', 'other'])
    expect(reasonLabel('received')).toBe('Delivery received')
    expect(reasonLabel('nope')).toBe('nope')
  })
})

describe('stockDelta', () => {
  it('shows the change with a sign', () => {
    expect(stockDelta(10, 13)).toBe('+3')
    expect(stockDelta(10, 8)).toBe('−2')
    expect(stockDelta(5, 5)).toBe('0')
  })
})

describe('parseCount', () => {
  it('accepts whole numbers from 0 to 100000', () => {
    expect(parseCount('0')).toBe(0)
    expect(parseCount(' 12 ')).toBe(12)
    expect(parseCount('100000')).toBe(100000)
  })
  it('refuses anything else', () => {
    expect(parseCount('')).toBeNull()
    expect(parseCount('-1')).toBeNull()
    expect(parseCount('1.5')).toBeNull()
    expect(parseCount('100001')).toBeNull()
    expect(parseCount('ten')).toBeNull()
  })
})
