import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  forgetOrder,
  getLastOrder,
  getRecentOrders,
  rememberOrder,
} from './recentOrders'

// This suite runs in vitest's `node` environment (the rest of the suite is DB
// contract tests), so there is no localStorage. A tiny in-memory shim avoids
// pulling in jsdom just for this file.
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map()
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  }
}

const order = (n, over = {}) => ({
  orderNumber: n,
  email: 'buyer@example.com',
  total: 250,
  itemCount: 2,
  ...over,
})

beforeEach(() => {
  localStorage.clear()
  vi.useRealTimers()
})

describe('recentOrders', () => {
  it('remembers an order so tracking needs no written-down number', () => {
    rememberOrder(order('224-ABC123'))
    expect(getRecentOrders()).toHaveLength(1)
    expect(getLastOrder()).toMatchObject({
      orderNumber: '224-ABC123',
      email: 'buyer@example.com',
      total: 250,
    })
  })

  it('upper-cases the number and trims the email so lookups match the RPC', () => {
    // get_order_tracking compares upper(order_number) and lower(email).
    rememberOrder(order('224-abc123', { email: '  Buyer@Example.com ' }))
    expect(getLastOrder().orderNumber).toBe('224-ABC123')
    expect(getLastOrder().email).toBe('Buyer@Example.com')
  })

  it('lists newest first', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-01T10:00:00Z'))
    rememberOrder(order('224-OLD'))
    vi.setSystemTime(new Date('2026-08-06T10:00:00Z'))
    rememberOrder(order('224-NEW'))

    expect(getRecentOrders().map((o) => o.orderNumber)).toEqual(['224-NEW', '224-OLD'])
  })

  it('de-duplicates the same order number', () => {
    rememberOrder(order('224-ABC123'))
    rememberOrder(order('224-ABC123', { total: 999 }))
    const all = getRecentOrders()
    expect(all).toHaveLength(1)
    expect(all[0].total).toBe(999)
  })

  it('keeps at most 10, dropping the oldest', () => {
    for (let i = 0; i < 13; i++) rememberOrder(order(`224-${i}`))
    expect(getRecentOrders()).toHaveLength(10)
  })

  it('forgets one order without touching the rest', () => {
    rememberOrder(order('224-A'))
    rememberOrder(order('224-B'))
    forgetOrder('224-A')
    expect(getRecentOrders().map((o) => o.orderNumber)).toEqual(['224-B'])
  })

  it('ignores an order missing a number or email', () => {
    rememberOrder({ orderNumber: '224-X' })
    rememberOrder({ email: 'a@b.com' })
    expect(getRecentOrders()).toEqual([])
  })

  it('survives corrupt storage rather than breaking the page', () => {
    localStorage.setItem('224:recent-orders', '{not json')
    expect(getRecentOrders()).toEqual([])
    expect(getLastOrder()).toBeNull()
    rememberOrder(order('224-OK'))
    expect(getRecentOrders()).toHaveLength(1)
  })

  it('returns null when nothing has been ordered here', () => {
    expect(getLastOrder()).toBeNull()
  })
})
