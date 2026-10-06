import { describe, expect, it } from 'vitest'
import {
  bestSellers,
  bucketLabel,
  buildBuckets,
  csvField,
  itemsSummary,
  lowStockItems,
  neutralizeFormula,
  niceMax,
  ordersToCsv,
  paymentSplit,
  rangeStartIso,
  sastDateTime,
  sastDayKey,
  sastMonthKey,
  sastWeekKey,
  summarize,
} from './salesReport'

const order = (over = {}) => ({
  id: 'o1',
  order_number: '224-0001',
  created_at: '2026-10-05T08:00:00Z',
  status: 'pending',
  payment_method: 'cash_on_delivery',
  subtotal: 10000,
  shipping_fee: 5000,
  discount_cents: 0,
  total: 15000,
  customer_name: 'Thabo',
  customer_email: 'thabo@example.com',
  customer_phone: '0820000000',
  items: [{ id: 'p1', name: 'Gelato', price: 5000, quantity: 2, slug: 'gelato' }],
  ...over,
})

// 2026-10-05 12:00 SAST (a Monday).
const NOW = new Date('2026-10-05T10:00:00Z')

describe('SAST date keys', () => {
  it('rolls late-evening UTC into the next Johannesburg day', () => {
    expect(sastDayKey('2026-10-04T21:30:00Z')).toBe('2026-10-04')
    expect(sastDayKey('2026-10-04T22:30:00Z')).toBe('2026-10-05')
  })

  it('weeks start on Monday', () => {
    expect(sastWeekKey('2026-10-05T10:00:00Z')).toBe('2026-10-05') // Monday
    expect(sastWeekKey('2026-10-04T10:00:00Z')).toBe('2026-09-28') // Sunday
    expect(sastWeekKey('2026-10-04T22:30:00Z')).toBe('2026-10-05') // Sun UTC, Mon SAST
  })

  it('months follow local time at the boundary', () => {
    expect(sastMonthKey('2026-09-30T22:15:00Z')).toBe('2026-10')
  })

  it('formats CSV timestamps in SAST', () => {
    expect(sastDateTime('2026-10-04T22:30:00Z')).toBe('2026-10-05 00:30')
    expect(sastDateTime(null)).toBe('')
  })
})

describe('rangeStartIso', () => {
  it('day ranges include today and start at SAST midnight', () => {
    expect(rangeStartIso('7d', NOW)).toBe('2026-09-28T22:00:00.000Z') // 29 Sep 00:00 SAST
    expect(rangeStartIso('30d', NOW)).toBe('2026-09-05T22:00:00.000Z')
  })

  it('12 months starts on the 1st, eleven months back', () => {
    expect(rangeStartIso('12m', NOW)).toBe('2025-10-31T22:00:00.000Z') // 1 Nov 2025 SAST
  })

  it('all time has no start', () => {
    expect(rangeStartIso('all', NOW)).toBeNull()
  })
})

describe('summarize', () => {
  it('splits revenue (delivered) from booked (non-cancelled)', () => {
    const s = summarize([
      order({ status: 'delivered', total: 20000, discount_cents: 1000 }),
      order({ status: 'pending', total: 10000 }),
      order({ status: 'cancelled', total: 99999, discount_cents: 5000 }),
    ])
    expect(s).toEqual({
      revenue: 20000,
      booked: 30000,
      orderCount: 2,
      averageOrder: 15000,
      cancelled: 1,
      discounts: 1000,
    })
  })

  it('is all zeros for no orders (no divide-by-zero)', () => {
    expect(summarize([])).toEqual({
      revenue: 0, booked: 0, orderCount: 0, averageOrder: 0, cancelled: 0, discounts: 0,
    })
  })

  it('treats null money as zero', () => {
    expect(summarize([order({ total: null, discount_cents: null })]).booked).toBe(0)
  })
})

describe('buildBuckets', () => {
  it('builds one contiguous daily bucket per day, empty days included', () => {
    const buckets = buildBuckets([], '7d', NOW)
    expect(buckets.map(b => b.key)).toEqual([
      '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05',
    ])
    expect(buckets.every(b => b.delivered === 0 && b.other === 0)).toBe(true)
  })

  it('stacks delivered vs other and skips cancelled', () => {
    const buckets = buildBuckets([
      order({ created_at: '2026-10-04T22:30:00Z', status: 'delivered', total: 100 }), // 5 Oct SAST
      order({ created_at: '2026-10-05T09:00:00Z', status: 'confirmed', total: 40 }),
      order({ created_at: '2026-10-05T09:00:00Z', status: 'cancelled', total: 999 }),
    ], '7d', NOW)
    const today = buckets.at(-1)
    expect(today).toMatchObject({ key: '2026-10-05', delivered: 100, other: 40, orders: 2 })
    expect(buckets.at(-2).orders).toBe(0)
  })

  it('uses weeks for 90 days and months for 12 months', () => {
    const weeks = buildBuckets([], '90d', NOW)
    expect(weeks.at(-1).key).toBe('2026-10-05')
    expect(weeks.length).toBeGreaterThanOrEqual(13)
    const months = buildBuckets([], '12m', NOW)
    expect(months).toHaveLength(12)
    expect(months[0].key).toBe('2025-11')
    expect(months.at(-1).key).toBe('2026-10')
  })

  it('all time starts at the earliest order month', () => {
    const months = buildBuckets([
      order({ created_at: '2026-07-15T10:00:00Z', total: 500 }),
    ], 'all', NOW)
    expect(months.map(m => m.key)).toEqual(['2026-07', '2026-08', '2026-09', '2026-10'])
    expect(months[0].other).toBe(500)
  })

  it('labels buckets in en-ZA style', () => {
    expect(bucketLabel('2026-10-05', 'day')).toMatch(/5 Oct/)
    expect(bucketLabel('2026-09-28', 'week')).toMatch(/^Week of 28 Sep/)
    expect(bucketLabel('2026-10', 'month')).toMatch(/Oct 2026/)
  })
})

describe('niceMax', () => {
  it('rounds up to a clean axis maximum', () => {
    expect(niceMax(0)).toBe(0)
    expect(niceMax(7)).toBe(10)
    expect(niceMax(130)).toBe(200)
    expect(niceMax(2100)).toBe(2500)
    expect(niceMax(5000)).toBe(5000)
    expect(niceMax(51000)).toBe(100000)
  })
})

describe('bestSellers', () => {
  it('groups by product id + variant label and ranks by units', () => {
    const rows = bestSellers([
      order({ items: [
        { id: 'p1', name: 'Gelato', price: 5000, quantity: 1, variant_label: '3.5g' },
        { id: 'p1', name: 'Gelato', price: 9000, quantity: 1, variant_label: '7g' },
        { id: 'p2', name: 'Lighter', price: 2000, quantity: 3 },
      ] }),
      order({ items: [{ id: 'p1', name: 'Gelato', price: 5000, quantity: 2, variant_label: '3.5g' }] }),
      order({ status: 'cancelled', items: [{ id: 'p1', name: 'Gelato', price: 9000, quantity: 50, variant_label: '7g' }] }),
    ])
    expect(rows.map(r => [r.name, r.variantLabel, r.units, r.revenue])).toEqual([
      ['Gelato', '3.5g', 3, 15000],
      ['Lighter', null, 3, 6000],
      ['Gelato', '7g', 1, 9000],
    ])
  })

  it('caps at the limit and tolerates missing items', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, price: 100, quantity: i + 1 }))
    expect(bestSellers([order({ items }), order({ items: null })])).toHaveLength(10)
  })
})

describe('paymentSplit', () => {
  it('always lists the three methods and counts non-cancelled only', () => {
    const rows = paymentSplit([
      order({ payment_method: 'eft', total: 300 }),
      order({ payment_method: 'eft', total: 200 }),
      order({ payment_method: 'cash_on_delivery', status: 'cancelled', total: 999 }),
    ])
    expect(rows.map(r => [r.method, r.count, r.amount])).toEqual([
      ['cash_on_delivery', 0, 0],
      ['card_on_delivery', 0, 0],
      ['eft', 2, 500],
    ])
  })

  it('keeps unexpected methods instead of dropping their money', () => {
    const rows = paymentSplit([order({ payment_method: 'online', total: 100 }), order({ payment_method: null, total: 50 })])
    expect(rows.find(r => r.method === 'online')).toMatchObject({ count: 1, amount: 100 })
    expect(rows.find(r => r.method === 'unknown')).toMatchObject({ count: 1, amount: 50 })
  })
})

describe('lowStockItems', () => {
  it('lists products at or below 5, lowest first, skipping hidden ones', () => {
    const rows = lowStockItems([
      { id: 1, name: 'A', stock_quantity: 5, is_available: true },
      { id: 2, name: 'B', stock_quantity: 6, is_available: true },
      { id: 3, name: 'C', stock_quantity: 0, is_available: true },
      { id: 4, name: 'D', stock_quantity: 0, is_available: false },
    ])
    expect(rows.map(r => [r.name, r.stock])).toEqual([['C', 0], ['A', 5]])
  })

  it('uses variants when present', () => {
    const rows = lowStockItems([{
      id: 1, name: 'Gelato', stock_quantity: 100, is_available: true,
      product_variants: [
        { id: 'v1', label: '3.5g', stock_quantity: 2 },
        { id: 'v2', label: '7g', stock_quantity: 20 },
      ],
    }])
    expect(rows).toEqual([{ key: '1::v1', productId: 1, name: 'Gelato — 3.5g', stock: 2 }])
  })

  it('falls back to product stock for an empty variants array', () => {
    expect(lowStockItems([{ id: 1, name: 'X', stock_quantity: 1, product_variants: [] }])).toHaveLength(1)
  })
})

describe('CSV', () => {
  it('summarises items with variant labels', () => {
    expect(itemsSummary([
      { name: 'Gelato', quantity: 2, variant_label: '3.5g' },
      { name: 'Lighter', quantity: 1 },
    ])).toBe('2× Gelato — 3.5g; 1× Lighter')
    expect(itemsSummary(null)).toBe('')
  })

  it('neutralises formula-looking cells', () => {
    for (const s of ['=SUM(A1)', '+27', '-1', '@cmd', '\tx']) {
      expect(neutralizeFormula(s)).toBe(`'${s}`)
    }
    expect(neutralizeFormula('Thabo')).toBe('Thabo')
    expect(neutralizeFormula(null)).toBe('')
  })

  it('quotes commas, quotes and newlines', () => {
    expect(csvField('a,b')).toBe('"a,b"')
    expect(csvField('say "hi"')).toBe('"say ""hi"""')
    expect(csvField('plain')).toBe('plain')
  })

  it('writes a header and rand amounts with 2 decimals', () => {
    const csv = ordersToCsv([order({
      customer_name: '=HYPERLINK("x")',
      discount_cents: 1250,
      items: [{ name: 'Gelato', quantity: 2, variant_label: '3.5g' }],
    })])
    const [header, row] = csv.split('\r\n')
    expect(header).toBe('order_number,date,status,payment_method,customer_name,email,phone,items,subtotal,discount,delivery,total')
    expect(row).toBe(
      '224-0001,2026-10-05 10:00,Order Placed,Cash on Delivery,"\'=HYPERLINK(""x"")",thabo@example.com,0820000000,2× Gelato — 3.5g,100.00,12.50,50.00,150.00'
    )
  })

  it('header only for no orders', () => {
    expect(ordersToCsv([]).split('\r\n')).toHaveLength(1)
  })
})
