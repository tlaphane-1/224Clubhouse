import { useEffect, useId, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle, BadgePercent, Banknote, ChartColumn, Download, Receipt, ShoppingCart, Wallet, XCircle,
} from 'lucide-react'
import AdminLayout from '../../components/admin/AdminLayout'
import StatsCard from '../../components/admin/StatsCard'
import { useSalesOrders } from '../../hooks/useSalesReport'
import { useAllProducts } from '../../hooks/useProducts'
import { formatZAR } from '../../utils/formatCurrency'
import {
  RANGES, bestSellers, buildBuckets, getRange, lowStockItems, niceMax, ordersToCsv, paymentSplit, sastDayKey,
  summarize,
} from '../../utils/salesReport'

function downloadCsv(orders, rangeKey) {
  const blob = new Blob([ordersToCsv(orders)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `orders-${rangeKey}-${sastDayKey(new Date())}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

const Panel = ({ title, action, children }) => (
  <section className="bg-surface border border-border rounded-xl p-4 sm:p-6">
    <div className="flex items-center justify-between gap-3 mb-4">
      <h2 className="font-heading text-lg font-semibold text-white">{title}</h2>
      {action}
    </div>
    {children}
  </section>
)

function ErrorPanel({ message, onRetry }) {
  return (
    <div className="bg-surface border border-red-500/20 rounded-2xl p-8 text-center max-w-md mx-auto">
      <AlertTriangle size={28} className="text-red-400 mx-auto mb-3" />
      <p className="text-white text-sm mb-5">{message}</p>
      <button onClick={onRetry} className="btn-gold text-sm">Retry</button>
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading report">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="bg-surface border border-border rounded-xl p-6">
            <div className="skeleton h-3 w-24 rounded mb-3" />
            <div className="skeleton h-7 w-32 rounded" />
          </div>
        ))}
      </div>
      <div className="bg-surface border border-border rounded-xl p-6">
        <div className="skeleton h-4 w-40 rounded mb-6" />
        <div className="skeleton h-48 w-full rounded" />
      </div>
    </div>
  )
}

/** Short rand label for axis ticks: R0, R500, R1.5k, R12k. */
function axisRand(centsValue) {
  const r = centsValue / 100
  if (r >= 1000) return `R${(r / 1000).toLocaleString('en-ZA', { maximumFractionDigits: 1 })}k`
  return `R${r.toLocaleString('en-ZA', { maximumFractionDigits: 0 })}`
}

const Swatch = ({ className }) => <span aria-hidden="true" className={`inline-block w-3 h-3 rounded-full ${className}`} />

/**
 * Stacked columns: delivered (collected, gold) under other booked (owed, muted).
 * Gold vs muted passes the CVD and normal-vision separation checks on the
 * surface; identity also comes from the legend, the readout and the table.
 */
function RevenueChart({ buckets, rangeLabel }) {
  const [active, setActive] = useState(null)
  const [showTable, setShowTable] = useState(false)
  const tableId = useId()

  const peak = Math.max(0, ...buckets.map(b => b.delivered + b.other))
  const max = niceMax(peak)
  const totalDelivered = buckets.reduce((s, b) => s + b.delivered, 0)
  const totalOther = buckets.reduce((s, b) => s + b.other, 0)
  const top = buckets.reduce((best, b) => (b.delivered + b.other > best.delivered + best.other ? b : best), buckets[0])
  const shown = buckets[active ?? buckets.length - 1]
  const pct = (v) => (max ? (v / max) * 100 : 0)

  const summary = `Revenue over ${rangeLabel}, ${buckets.length} periods. Delivered ${formatZAR(totalDelivered)}, `
    + `other booked ${formatZAR(totalOther)}.`
    + (peak ? ` Highest period ${top.label} at ${formatZAR(top.delivered + top.other)}.` : '')

  const ticks = max ? [max, max / 2, 0] : [0]
  const xLabels = buckets.length > 2
    ? [0, Math.floor((buckets.length - 1) / 2), buckets.length - 1]
    : buckets.map((_, i) => i)

  return (
    <Panel
      title="Revenue over time"
      action={
        <button
          type="button"
          onClick={() => setShowTable(v => !v)}
          aria-expanded={showTable}
          aria-controls={tableId}
          className="focus-ring text-xs uppercase tracking-widest text-muted hover:text-white h-11 px-2 rounded-lg"
        >
          {showTable ? 'Hide table' : 'Show table'}
        </button>
      }
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted mb-3">
        <span className="inline-flex items-center gap-1.5"><Swatch className="bg-gold" />Delivered</span>
        <span className="inline-flex items-center gap-1.5"><Swatch className="bg-muted" />Other booked</span>
      </div>

      {/* Readout for the hovered / tapped period (defaults to the latest). */}
      <p className="text-sm text-white mb-4 min-h-10 sm:min-h-5">
        <span className="font-semibold">{shown.label}</span>
        <span className="text-muted">
          {' · '}Delivered {formatZAR(shown.delivered)} · Other {formatZAR(shown.other)} · {shown.orders}{' '}
          {shown.orders === 1 ? 'order' : 'orders'}
        </span>
      </p>

      <div role="img" aria-label={summary} className="flex gap-2">
        <div className="relative w-12 flex-shrink-0 h-48 sm:h-56 text-xs text-muted tabular-nums" aria-hidden="true">
          {ticks.map(t => (
            <span
              key={t}
              className="absolute right-0 -translate-y-1/2 leading-none"
              style={{ top: `${100 - pct(t)}%` }}
            >
              {axisRand(t)}
            </span>
          ))}
        </div>
        <div className="flex-1 min-w-0">
          <div className="relative h-48 sm:h-56">
            {ticks.map(t => (
              <div key={t} aria-hidden="true" className="absolute inset-x-0 h-px bg-border" style={{ top: `${100 - pct(t)}%` }} />
            ))}
            <div className="absolute inset-0 flex items-end gap-0.5" onMouseLeave={() => setActive(null)}>
              {buckets.map((b, i) => {
                const hasOther = b.other > 0
                const hasDelivered = b.delivered > 0
                return (
                  <div
                    key={b.key}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => setActive(i)}
                    className={`flex-1 min-w-0 h-full flex flex-col justify-end items-center rounded-t ${
                      active === i ? 'bg-white/5' : ''
                    }`}
                  >
                    <div className="w-full max-w-6 flex flex-col gap-0.5" style={{ height: `${pct(b.delivered + b.other)}%` }}>
                      {hasOther && (
                        <div className="bg-muted rounded-t" style={{ flexGrow: b.other, flexBasis: 0 }} />
                      )}
                      {hasDelivered && (
                        <div
                          className={`bg-gold ${hasOther ? '' : 'rounded-t'}`}
                          style={{ flexGrow: b.delivered, flexBasis: 0 }}
                        />
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          <div className="relative h-5 mt-2 text-xs text-muted" aria-hidden="true">
            {xLabels.map((i, n) => (
              <span
                key={buckets[i].key}
                className={`absolute whitespace-nowrap ${
                  n === 0 ? 'left-0' : n === xLabels.length - 1 ? 'right-0' : 'left-1/2 -translate-x-1/2'
                }`}
              >
                {buckets[i].label.replace(/^Week of /, '')}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div id={tableId} hidden={!showTable} className="mt-6 overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Revenue per period</caption>
          <thead>
            <tr className="border-b border-border text-muted uppercase tracking-widest text-xs">
              <th scope="col" className="pb-3 text-left font-medium">Period</th>
              <th scope="col" className="pb-3 text-right font-medium">Delivered</th>
              <th scope="col" className="pb-3 text-right font-medium">Other</th>
              <th scope="col" className="pb-3 text-right font-medium">Orders</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {buckets.map(b => (
              <tr key={b.key} className="border-b border-border/50 last:border-0">
                <th scope="row" className="py-2 text-left font-normal text-white whitespace-nowrap pr-3">{b.label}</th>
                <td className="py-2 text-right text-white">{formatZAR(b.delivered)}</td>
                <td className="py-2 text-right text-muted">{formatZAR(b.other)}</td>
                <td className="py-2 text-right text-muted">{b.orders}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

function BestSellers({ rows }) {
  return (
    <Panel title="Best sellers">
      {rows.length === 0 ? (
        <p className="text-muted text-sm">No items sold in this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted uppercase tracking-widest text-xs">
                <th scope="col" className="pb-3 text-left font-medium">Product</th>
                <th scope="col" className="pb-3 text-right font-medium">Units</th>
                <th scope="col" className="pb-3 text-right font-medium">Revenue</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {rows.map(r => (
                <tr key={r.key} className="border-b border-border/50 last:border-0">
                  <td className="py-3 pr-3 text-white">
                    {r.name}
                    {r.variantLabel && <span className="text-muted"> — {r.variantLabel}</span>}
                  </td>
                  <td className="py-3 text-right text-white">{r.units}</td>
                  <td className="py-3 pl-3 text-right text-gold whitespace-nowrap">{formatZAR(r.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-muted text-xs mt-3">Top 10 by units, cancelled orders excluded.</p>
        </div>
      )}
    </Panel>
  )
}

function PaymentSplit({ rows }) {
  const total = rows.reduce((s, r) => s + r.amount, 0)
  return (
    <Panel title="Payment methods">
      <ul className="space-y-4">
        {rows.map(r => {
          const share = total ? Math.round((r.amount / total) * 100) : 0
          return (
            <li key={r.method}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-white">{r.label}</span>
                <span className="text-white tabular-nums whitespace-nowrap">{formatZAR(r.amount)}</span>
              </div>
              <div className="flex items-center gap-3 mt-1.5">
                <div className="flex-1 h-1.5 bg-border rounded-full overflow-hidden" aria-hidden="true">
                  <div className="h-full bg-gold rounded-full" style={{ width: `${share}%` }} />
                </div>
                <span className="text-muted text-xs tabular-nums whitespace-nowrap">
                  {r.count} {r.count === 1 ? 'order' : 'orders'} · {share}%
                </span>
              </div>
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}

function LowStock() {
  const { data: products, isLoading, isError, refetch } = useAllProducts()
  const items = useMemo(() => lowStockItems(products ?? []), [products])

  return (
    <Panel
      title="Low stock"
      action={
        <Link to="/admin/products" className="focus-ring h-11 inline-flex items-center text-xs uppercase tracking-widest text-gold underline underline-offset-2 rounded-lg">
          Products
        </Link>
      }
    >
      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map(i => <div key={i} className="skeleton h-5 w-full rounded" />)}
        </div>
      ) : isError ? (
        <div className="text-center py-4">
          <p className="text-white text-sm mb-4">Couldn't load products.</p>
          <button onClick={() => refetch()} className="btn-outline text-sm">Retry</button>
        </div>
      ) : items.length === 0 ? (
        <p className="text-muted text-sm">Everything on sale has more than 5 in stock.</p>
      ) : (
        <ul className="divide-y divide-border/50">
          {items.map(i => (
            <li key={i.key} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <span className="text-white min-w-0">{i.name}</span>
              <span className={`tabular-nums whitespace-nowrap ${i.stock === 0 ? 'text-red-400' : 'text-yellow-400'}`}>
                {i.stock === 0 ? 'Out of stock' : `${i.stock} left`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

export default function Reports() {
  const [rangeKey, setRangeKey] = useState('30d')
  const range = getRange(rangeKey)
  const { data: orders, isLoading, isError, refetch } = useSalesOrders(rangeKey)

  useEffect(() => {
    document.title = 'Reports | 224 Admin'
  }, [])

  const report = useMemo(() => {
    if (!orders) return null
    return {
      kpis: summarize(orders),
      buckets: buildBuckets(orders, rangeKey),
      sellers: bestSellers(orders, 10),
      payments: paymentSplit(orders),
    }
  }, [orders, rangeKey])

  const hasOrders = (orders?.length ?? 0) > 0

  return (
    <AdminLayout>
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="font-heading text-3xl font-bold text-white">Sales Reports</h1>
          <p className="text-muted text-sm mt-1">Revenue counts delivered orders; booked is everything not cancelled.</p>
        </div>
        <button
          onClick={() => downloadCsv(orders, rangeKey)}
          disabled={!hasOrders}
          className="btn-gold text-sm inline-flex items-center justify-center gap-2 self-start sm:self-auto disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Download size={16} />
          Export orders CSV{hasOrders ? ` (${orders.length})` : ''}
        </button>
      </div>

      <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0 mb-6" role="group" aria-label="Report period">
        {RANGES.map(r => (
          <button
            key={r.key}
            type="button"
            onClick={() => setRangeKey(r.key)}
            aria-pressed={rangeKey === r.key}
            className={`chip ${rangeKey === r.key ? 'chip-active' : 'chip-idle'}`}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="space-y-6">
        {isLoading ? (
          <LoadingSkeleton />
        ) : isError ? (
          <ErrorPanel
            message="Couldn't load orders for this period. Please check your connection and try again."
            onRetry={() => refetch()}
          />
        ) : !hasOrders ? (
          <div className="bg-surface border border-border rounded-2xl p-8 text-center">
            <ChartColumn size={28} className="text-muted mx-auto mb-3" />
            <p className="text-white text-sm mb-1">No orders in this period</p>
            <p className="text-muted text-xs">Try a longer range.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              <StatsCard title="Revenue (delivered)" value={formatZAR(report.kpis.revenue)} icon={Banknote} />
              <StatsCard title="Booked" value={formatZAR(report.kpis.booked)} icon={Wallet} trend="All non-cancelled orders" />
              <StatsCard title="Orders" value={report.kpis.orderCount} icon={ShoppingCart} />
              <StatsCard title="Average order" value={formatZAR(report.kpis.averageOrder)} icon={Receipt} />
              <StatsCard title="Cancelled" value={report.kpis.cancelled} icon={XCircle} />
              <StatsCard title="Discounts given" value={formatZAR(report.kpis.discounts)} icon={BadgePercent} />
            </div>

            <RevenueChart buckets={report.buckets} rangeLabel={range.label} />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
              <BestSellers rows={report.sellers} />
              <PaymentSplit rows={report.payments} />
            </div>
          </>
        )}

        <LowStock />
      </div>
    </AdminLayout>
  )
}

