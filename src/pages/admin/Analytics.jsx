import { useEffect, useId, useState } from 'react'
import { Users, Eye, UserPlus, MousePointerClick, AlertTriangle } from 'lucide-react'
import AdminLayout from '../../components/admin/AdminLayout'
import StatsCard from '../../components/admin/StatsCard'
import { useSiteAnalytics } from '../../hooks/useSiteAnalytics'

const RANGES = [
  { days: 1, label: 'Today' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
]

const SOURCE_LABELS = {
  direct: 'Direct / WhatsApp app',
  whatsapp: 'WhatsApp',
  google: 'Google',
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  twitter: 'X / Twitter',
  bing: 'Bing',
}

const dayLabel = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0)

function Panel({ title, children, action }) {
  return (
    <section className="bg-surface border border-border rounded-xl p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="font-heading text-lg font-semibold text-white">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function DailyChart({ daily }) {
  const [active, setActive] = useState(null)
  const [showTable, setShowTable] = useState(false)
  const tableId = useId()
  const max = Math.max(1, ...daily.map(d => d.visitors))
  const shown = daily[active ?? daily.length - 1]
  const total = daily.reduce((s, d) => s + d.visitors, 0)

  return (
    <Panel
      title="Visitors per day"
      action={
        <button type="button" onClick={() => setShowTable(v => !v)} aria-expanded={showTable} aria-controls={tableId}
          className="focus-ring text-xs uppercase tracking-widest text-muted hover:text-white h-11 px-2 rounded-lg">
          {showTable ? 'Hide table' : 'Show table'}
        </button>
      }
    >
      <p className="text-sm text-white mb-4">
        <span className="font-semibold">{dayLabel(shown.day)}</span>
        <span className="text-muted"> · {shown.visitors} visitors · {shown.page_views} page views · {shown.signups} signups</span>
      </p>
      {/* Bars are a pointer convenience; the table carries the same data for
          keyboard and screen-reader users. */}
      <div role="img" aria-label={`${total} visitor-days over ${daily.length} days`} className="flex items-end gap-1 h-40 sm:h-48">
        {daily.map((d, i) => (
          <div key={d.day} onMouseEnter={() => setActive(i)} onClick={() => setActive(i)}
            className={`flex-1 min-w-0 h-full flex items-end rounded-t ${active === i ? 'bg-white/5' : ''}`}>
            <div className="w-full bg-gold rounded-t" style={{ height: `${(d.visitors / max) * 100}%`, minHeight: d.visitors ? 2 : 0 }} />
          </div>
        ))}
      </div>
      <div className="flex justify-between text-xs text-muted mt-2" aria-hidden="true">
        <span>{dayLabel(daily[0].day)}</span>
        <span>{dayLabel(daily[daily.length - 1].day)}</span>
      </div>
      {showTable && (
        <div id={tableId} className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-muted text-xs uppercase tracking-widest text-left">
              <th className="py-2 pr-2 font-medium">Day</th><th className="py-2 px-2 font-medium text-right">Visitors</th>
              <th className="py-2 px-2 font-medium text-right">Page views</th><th className="py-2 pl-2 font-medium text-right">Signups</th>
            </tr></thead>
            <tbody>
              {daily.map(d => (
                <tr key={d.day} className="border-t border-border">
                  <td className="py-2 pr-2 text-white">{dayLabel(d.day)}</td>
                  <td className="py-2 px-2 text-right tabular-nums text-white">{d.visitors}</td>
                  <td className="py-2 px-2 text-right tabular-nums text-muted">{d.page_views}</td>
                  <td className="py-2 pl-2 text-right tabular-nums text-muted">{d.signups}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

function BarList({ rows, label, value, empty }) {
  if (rows.length === 0) return <p className="text-muted text-sm">{empty}</p>
  const max = Math.max(1, ...rows.map(value))
  return (
    <ul className="space-y-3">
      {rows.map((r, i) => (
        <li key={i}>
          <div className="flex justify-between gap-3 text-sm mb-1">
            <span className="text-white truncate">{label(r)}</span>
            <span className="text-muted tabular-nums flex-shrink-0">{value(r)}</span>
          </div>
          <div className="h-1.5 bg-border rounded-full overflow-hidden">
            <div className="h-full bg-gold rounded-full" style={{ width: `${(value(r) / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

export default function Analytics() {
  const [days, setDays] = useState(7)
  const { data, isLoading, isError, refetch } = useSiteAnalytics(days)

  useEffect(() => {
    document.title = 'Visitors | 224 Admin'
  }, [])

  const f = data?.funnel

  return (
    <AdminLayout>
      <div className="mb-6">
        <h1 className="font-heading text-3xl font-bold text-white">Visitors</h1>
        <p className="text-muted text-sm mt-1">
          Counted on the live site since 7 October 2026. No cookies; your own admin browsing isn't counted.
        </p>
      </div>

      <div className="flex gap-2 overflow-x-auto scrollbar-hide mb-6" role="group" aria-label="Date range">
        {RANGES.map(r => (
          <button key={r.days} type="button" aria-pressed={days === r.days} onClick={() => setDays(r.days)}
            className={`chip ${days === r.days ? 'chip-active' : 'chip-idle'}`}>
            {r.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4" role="status" aria-label="Loading analytics">
          {[0, 1, 2, 3].map(i => <div key={i} className="h-28 skeleton rounded-xl" />)}
        </div>
      ) : isError ? (
        <div className="bg-surface border border-red-500/20 rounded-2xl p-8 text-center max-w-md mx-auto">
          <AlertTriangle size={28} className="text-red-400 mx-auto mb-3" />
          <p className="text-white text-sm mb-5">Couldn't load visitor numbers.</p>
          <button type="button" onClick={() => refetch()} className="btn-gold text-sm">Retry</button>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <StatsCard title="Visitors" value={data.visitors} icon={Users} trend={`${data.new_visitors} new`} />
            <StatsCard title="Page views" value={data.page_views} icon={Eye}
              trend={data.sessions ? `${(data.page_views / data.sessions).toFixed(1)} pages per visit` : undefined} />
            <StatsCard title="New accounts" value={data.signups} icon={UserPlus} />
            <StatsCard title="Visitors who ordered" value={`${pct(f.ordered, f.visited)}%`} icon={MousePointerClick}
              trend={`${f.ordered} of ${f.visited}`} />
          </div>

          {data.visitors === 0 && (
            <div className="bg-surface border border-border rounded-2xl p-8 text-center">
              <Users size={28} className="text-muted mx-auto mb-3" />
              <p className="text-white text-sm mb-1">No visitors recorded in this period yet</p>
              <p className="text-muted text-xs">Numbers appear as people browse the live site.</p>
            </div>
          )}

          <DailyChart daily={data.daily} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Panel title="Shopping funnel">
              <BarList
                rows={[
                  { label: 'Visited the site', n: f.visited },
                  { label: 'Added to cart', n: f.added_to_cart },
                  { label: 'Started checkout', n: f.started_checkout },
                  { label: 'Placed an order', n: f.ordered },
                ]}
                label={r => `${r.label} · ${pct(r.n, f.visited)}%`}
                value={r => r.n}
                empty="No visitors yet."
              />
            </Panel>
            <Panel title="Where visitors come from">
              <BarList rows={data.sources} label={r => SOURCE_LABELS[r.source] ?? r.source} value={r => r.visitors} empty="No visitors yet." />
              <p className="text-muted text-xs mt-4">
                Links opened inside the WhatsApp app usually show as Direct. Add <span className="font-mono text-white">?utm_source=whatsapp</span> to links you share to count them separately.
              </p>
            </Panel>
            <Panel title="Most viewed pages">
              <BarList rows={data.top_pages} label={r => r.path} value={r => r.views} empty="No page views yet." />
            </Panel>
            <Panel title="Devices">
              <BarList rows={data.devices} label={r => r.device[0].toUpperCase() + r.device.slice(1)} value={r => r.visitors} empty="No visitors yet." />
            </Panel>
          </div>
        </div>
      )}
    </AdminLayout>
  )
}
