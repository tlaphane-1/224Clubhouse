import { useTodaySummary } from '../../hooks/useToday'
import { formatZAR } from '../../utils/formatCurrency'

// Today's sales at a glance — refreshes every 30 seconds by itself.
// Used on the counter's Today tab and the admin dashboard.
export default function TodayPanel({ compact = false }) {
  const { data, isLoading, isError, refetch, dataUpdatedAt } = useTodaySummary()

  if (isLoading) {
    return <div className="h-40 skeleton rounded-2xl" aria-busy="true" aria-label="Loading today's sales" />
  }
  if (isError) {
    return (
      <section className="bg-surface border border-red-500/20 rounded-2xl p-6">
        <p className="text-red-400 text-sm mb-3">Couldn&apos;t load today&apos;s sales.</p>
        <button type="button" onClick={() => refetch()} className="btn-outline min-h-11 px-4 text-xs uppercase tracking-widest">Try again</button>
      </section>
    )
  }

  const updated = new Date(dataUpdatedAt).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })
  const card = 'bg-surface border border-border rounded-2xl p-5'
  return (
    <section aria-labelledby="today-heading" className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="today-heading" className="text-gold text-xs uppercase tracking-widest">Today (live)</h2>
        <span className="text-muted text-xs">Updated {updated}</span>
      </div>
      <div className={`grid gap-4 ${compact ? 'grid-cols-2' : 'grid-cols-2 md:grid-cols-4'}`}>
        <div className={card}>
          <p className="text-muted text-xs uppercase tracking-widest">Sales</p>
          <p className="text-white text-2xl font-bold mt-1">{formatZAR(data.total)}</p>
        </div>
        <div className={card}>
          <p className="text-muted text-xs uppercase tracking-widest">Orders</p>
          <p className="text-white text-2xl font-bold mt-1">{data.sales}</p>
        </div>
        <div className={card}>
          <p className="text-muted text-xs uppercase tracking-widest">In store</p>
          <p className="text-white text-2xl font-bold mt-1">{formatZAR(data.counter)}</p>
        </div>
        <div className={card}>
          <p className="text-muted text-xs uppercase tracking-widest">Online</p>
          <p className="text-white text-2xl font-bold mt-1">{formatZAR(data.online)}</p>
        </div>
      </div>
      {!compact && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className={card}>
            <h3 className="text-white font-semibold text-sm mb-3">Top sellers today</h3>
            {data.top.length === 0 ? (
              <p className="text-muted text-sm">No sales yet today.</p>
            ) : (
              <ul className="space-y-1.5">
                {data.top.map(t => (
                  <li key={t.name} className="flex justify-between gap-3 text-sm">
                    <span className="text-white">{t.name}</span><span className="text-muted">{t.quantity} sold</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className={card}>
            <h3 className="text-white font-semibold text-sm mb-3">Low stock</h3>
            {data.low_stock.length === 0 ? (
              <p className="text-muted text-sm">Nothing running low.</p>
            ) : (
              <ul className="space-y-1.5">
                {data.low_stock.map(l => (
                  <li key={l.name} className="flex justify-between gap-3 text-sm">
                    <span className="text-white">{l.name}</span>
                    <span className={l.left === 0 ? 'text-red-400' : 'text-gold'}>{l.left === 0 ? 'Sold out' : `${l.left} left`}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
