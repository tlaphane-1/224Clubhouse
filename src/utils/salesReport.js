/**
 * Pure aggregation for the admin Sales Reports page. No React, no DOM, no
 * Supabase — everything here takes plain rows and returns plain values so it
 * can be unit-tested in vitest's node environment.
 *
 * Money in and out is integer cents (ZAR), except the CSV, which is rands.
 *
 * Dates are bucketed in Africa/Johannesburg local time. SAST is a fixed UTC+2
 * with no daylight saving, so a constant offset is exact and avoids depending
 * on the runtime's ICU time-zone data for the arithmetic.
 */
import { PAYMENT_METHODS, paymentLabel, statusLabel } from './orderStatus'

const SAST_OFFSET_MS = 2 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

export const LOW_STOCK_THRESHOLD = 5

export const RANGES = [
  { key: '7d', label: '7 days', days: 7, granularity: 'day' },
  { key: '30d', label: '30 days', days: 30, granularity: 'day' },
  { key: '90d', label: '90 days', days: 90, granularity: 'week' },
  { key: '12m', label: '12 months', months: 12, granularity: 'month' },
  { key: 'all', label: 'All time', granularity: 'month' },
]

export const getRange = (key) => RANGES.find(r => r.key === key) ?? RANGES[1]

// ---------------------------------------------------------------------------
// Status helpers. COD business: money is only collected on delivery, so
// "revenue" is delivered orders (matches the Dashboard); "booked" is every
// order that hasn't been cancelled.
// ---------------------------------------------------------------------------
export const isCancelled = (o) => o?.status === 'cancelled'
export const isBooked = (o) => !isCancelled(o)
export const isDelivered = (o) => o?.status === 'delivered'

const cents = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// ---------------------------------------------------------------------------
// SAST date keys
// ---------------------------------------------------------------------------

/** 'YYYY-MM-DD' of the instant in Johannesburg local time. */
export function sastDayKey(input) {
  const t = new Date(input).getTime()
  return new Date(t + SAST_OFFSET_MS).toISOString().slice(0, 10)
}

/** UTC instant of local midnight for a 'YYYY-MM-DD' SAST day. */
function sastMidnightMs(dayKey) {
  return Date.parse(`${dayKey}T00:00:00Z`) - SAST_OFFSET_MS
}

/** Shift a 'YYYY-MM-DD' key by n calendar days. */
function addDays(dayKey, n) {
  return new Date(Date.parse(`${dayKey}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10)
}

/** 'YYYY-MM-DD' of the Monday starting the SAST week containing the instant. */
export function sastWeekKey(input) {
  const day = sastDayKey(input)
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay() // 0 = Sunday
  return addDays(day, -((dow + 6) % 7))
}

/** 'YYYY-MM' of the instant in Johannesburg local time. */
export function sastMonthKey(input) {
  return sastDayKey(input).slice(0, 7)
}

function addMonths(monthKey, n) {
  const [y, m] = monthKey.split('-').map(Number)
  const total = y * 12 + (m - 1) + n
  const yy = Math.floor(total / 12)
  const mm = (total % 12) + 1
  return `${yy}-${String(mm).padStart(2, '0')}`
}

const keyFor = {
  day: sastDayKey,
  week: sastWeekKey,
  month: sastMonthKey,
}

/**
 * ISO timestamp of the first instant in range, or null for "all time".
 * Day ranges include today, so "7 days" = today plus the six before it.
 * "12 months" = this month plus the eleven before it, from the 1st.
 */
export function rangeStartIso(rangeKey, now = new Date()) {
  const range = getRange(rangeKey)
  const today = sastDayKey(now)
  if (range.days) {
    return new Date(sastMidnightMs(addDays(today, -(range.days - 1)))).toISOString()
  }
  if (range.months) {
    const firstMonth = addMonths(today.slice(0, 7), -(range.months - 1))
    return new Date(sastMidnightMs(`${firstMonth}-01`)).toISOString()
  }
  return null
}

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------

export function summarize(orders = []) {
  let revenue = 0
  let booked = 0
  let orderCount = 0
  let cancelled = 0
  let discounts = 0
  for (const o of orders) {
    if (isCancelled(o)) {
      cancelled += 1
      continue
    }
    orderCount += 1
    booked += cents(o.total)
    discounts += cents(o.discount_cents)
    if (isDelivered(o)) revenue += cents(o.total)
  }
  return {
    revenue,
    booked,
    orderCount,
    averageOrder: orderCount ? Math.round(booked / orderCount) : 0,
    cancelled,
    discounts,
  }
}

// ---------------------------------------------------------------------------
// Time buckets
// ---------------------------------------------------------------------------

const labelFormats = {
  day: new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
  week: new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
  month: new Intl.DateTimeFormat('en-ZA', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
}

/** Human label for a bucket key. Keys are already SAST dates, so format as UTC. */
export function bucketLabel(key, granularity) {
  const date = new Date(granularity === 'month' ? `${key}-01T00:00:00Z` : `${key}T00:00:00Z`)
  const text = labelFormats[granularity].format(date)
  return granularity === 'week' ? `Week of ${text}` : text
}

/**
 * Contiguous buckets from the start of the range to now (empty periods
 * included, so gaps show as gaps). Each bucket splits non-cancelled money into
 * delivered vs other (booked but not yet collected).
 */
export function buildBuckets(orders = [], rangeKey, now = new Date()) {
  const { granularity } = getRange(rangeKey)
  const toKey = keyFor[granularity]
  const startIso = rangeStartIso(rangeKey, now)

  let firstKey
  if (startIso) {
    firstKey = toKey(startIso)
  } else if (orders.length) {
    firstKey = orders.reduce((min, o) => {
      const k = toKey(o.created_at)
      return k < min ? k : min
    }, toKey(now))
  } else {
    firstKey = toKey(now)
  }
  const lastKey = toKey(now)

  const step = granularity === 'month'
    ? (k) => addMonths(k, 1)
    : (k) => addDays(k, granularity === 'week' ? 7 : 1)

  const buckets = []
  const byKey = new Map()
  for (let k = firstKey; k <= lastKey; k = step(k)) {
    const b = { key: k, label: bucketLabel(k, granularity), delivered: 0, other: 0, orders: 0 }
    buckets.push(b)
    byKey.set(k, b)
  }

  for (const o of orders) {
    if (!isBooked(o)) continue
    const b = byKey.get(toKey(o.created_at))
    if (!b) continue
    b.orders += 1
    if (isDelivered(o)) b.delivered += cents(o.total)
    else b.other += cents(o.total)
  }
  return buckets
}

/**
 * A "nice" axis maximum (1, 2, 2.5 or 5 × 10^n) at or above `max`, so tick
 * labels land on clean round values. Returns 0 for no data.
 */
export function niceMax(max) {
  if (!(max > 0)) return 0
  const pow = 10 ** Math.floor(Math.log10(max))
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (m * pow >= max) return m * pow
  }
  return 10 * pow
}

// ---------------------------------------------------------------------------
// Best sellers / payment split
// ---------------------------------------------------------------------------

/** Top products by units from non-cancelled orders, keyed by product + variant. */
export function bestSellers(orders = [], limit = 10) {
  const rows = new Map()
  for (const o of orders) {
    if (!isBooked(o) || !Array.isArray(o.items)) continue
    for (const item of o.items) {
      const label = item.variant_label || ''
      const key = `${item.id ?? item.slug ?? item.name}::${label}`
      const qty = Number(item.quantity) || 0
      const row = rows.get(key) ?? {
        key,
        id: item.id ?? null,
        name: item.name ?? 'Unknown product',
        variantLabel: label || null,
        units: 0,
        revenue: 0,
      }
      row.units += qty
      row.revenue += cents(item.price) * qty
      rows.set(key, row)
    }
  }
  return [...rows.values()]
    .sort((a, b) => b.units - a.units || b.revenue - a.revenue || a.name.localeCompare(b.name))
    .slice(0, limit)
}

/** Non-cancelled order count + total per payment method, known methods first. */
export function paymentSplit(orders = []) {
  const rows = new Map(
    PAYMENT_METHODS.map(m => [m, { method: m, label: paymentLabel(m), count: 0, amount: 0 }])
  )
  for (const o of orders) {
    if (!isBooked(o)) continue
    const m = o.payment_method || 'unknown'
    const row = rows.get(m) ?? { method: m, label: m === 'unknown' ? 'Not recorded' : paymentLabel(m), count: 0, amount: 0 }
    row.count += 1
    row.amount += cents(o.total)
    rows.set(m, row)
  }
  return [...rows.values()]
}

// ---------------------------------------------------------------------------
// Low stock
// ---------------------------------------------------------------------------

/**
 * Products (or their variants) at or below the threshold, lowest first.
 * Hidden products (is_available === false) are skipped — they aren't on sale,
 * so their stock isn't urgent.
 */
export function lowStockItems(products = [], threshold = LOW_STOCK_THRESHOLD) {
  const out = []
  for (const p of products) {
    if (!p || p.is_available === false) continue
    const variants = Array.isArray(p.product_variants) ? p.product_variants : []
    if (variants.length) {
      for (const v of variants) {
        const stock = Number(v.stock_quantity) || 0
        if (stock <= threshold) {
          out.push({ key: `${p.id}::${v.id ?? v.label}`, productId: p.id, name: `${p.name} — ${v.label}`, stock })
        }
      }
    } else {
      const stock = Number(p.stock_quantity) || 0
      if (stock <= threshold) out.push({ key: String(p.id), productId: p.id, name: p.name, stock })
    }
  }
  return out.sort((a, b) => a.stock - b.stock || a.name.localeCompare(b.name))
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

/** "2× Name — Label; 1× Other" */
export function itemsSummary(items) {
  if (!Array.isArray(items)) return ''
  return items
    .map(i => `${Number(i.quantity) || 0}× ${i.name ?? 'Item'}${i.variant_label ? ` — ${i.variant_label}` : ''}`)
    .join('; ')
}

/**
 * Spreadsheet formula-injection guard: a cell starting with = + - @ (or a tab
 * / carriage return) is run as a formula by Excel/Sheets. Customer names and
 * emails are user-supplied, so prefix such cells with a quote to force text.
 */
export function neutralizeFormula(value) {
  const v = value == null ? '' : String(value)
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
}

// RFC 4180-style escaping (same approach as admin/Newsletter.jsx).
export function csvField(value) {
  const v = value == null ? '' : String(value)
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

const textCell = (v) => csvField(neutralizeFormula(v))
// Numbers we format ourselves; never negative here, so no formula guard needed.
const randCell = (c) => (cents(c) / 100).toFixed(2)

/** 'YYYY-MM-DD HH:mm' in Johannesburg local time. */
export function sastDateTime(input) {
  // new Date(null) is the epoch, not invalid — treat missing as blank.
  if (input == null || input === '') return ''
  const t = new Date(input).getTime()
  if (!Number.isFinite(t)) return ''
  return new Date(t + SAST_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ')
}

export const CSV_HEADER = [
  'order_number', 'date', 'status', 'payment_method', 'customer_name', 'email', 'phone',
  'items', 'subtotal', 'discount', 'delivery', 'total',
]

export function ordersToCsv(orders = []) {
  const rows = orders.map(o => [
    textCell(o.order_number),
    textCell(sastDateTime(o.created_at)),
    textCell(statusLabel(o.status)),
    textCell(o.payment_method ? paymentLabel(o.payment_method) : ''),
    textCell(o.customer_name),
    textCell(o.customer_email),
    textCell(o.customer_phone),
    textCell(itemsSummary(o.items)),
    randCell(o.subtotal),
    randCell(o.discount_cents),
    randCell(o.shipping_fee),
    randCell(o.total),
  ].join(','))
  return [CSV_HEADER.join(','), ...rows].join('\r\n')
}

