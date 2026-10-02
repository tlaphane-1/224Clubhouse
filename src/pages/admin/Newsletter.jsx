import { useEffect, useState } from 'react'
import { Newspaper, Search, AlertTriangle, Download } from 'lucide-react'
import AdminLayout from '../../components/admin/AdminLayout'
import {
  useNewsletterSubscribers,
  isActiveSubscriber,
} from '../../hooks/useNewsletterSubscribers'

const STATUS_FILTERS = [
  { key: 'active', label: 'Active' },
  { key: 'unsubscribed', label: 'Unsubscribed' },
  { key: 'all', label: 'All' },
]

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-ZA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function fullName(s) {
  return [s.first_name, s.last_name].filter(Boolean).join(' ')
}

// RFC 4180-style escaping: wrap in quotes when the value contains a comma, quote or newline.
function csvField(value) {
  const v = value == null ? '' : String(value)
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

/**
 * Exports ACTIVE subscribers only. This CSV is what gets pasted into the mail
 * tool, so anyone who has clicked unsubscribe must never appear in it —
 * mailing them again is the exact thing the opt-out exists to prevent. The
 * caller filters by search; the unsubscribed guard here is not optional.
 */
function exportCsv(subscribers) {
  const active = subscribers.filter(isActiveSubscriber)
  const header = 'email,first_name,last_name,subscribed_at'
  const rows = active.map(s =>
    [s.email, s.first_name, s.last_name, s.subscribed_at].map(csvField).join(',')
  )
  const csv = [header, ...rows].join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `newsletter-subscribers-active-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export default function AdminNewsletter() {
  const { data: subscribers, isLoading, isError, refetch } = useNewsletterSubscribers()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('active')

  useEffect(() => {
    document.title = 'Newsletter | 224 Admin'
  }, [])

  const q = search.toLowerCase()
  const searched = (subscribers ?? []).filter(s =>
    fullName(s).toLowerCase().includes(q) ||
    s.email.toLowerCase().includes(q)
  )
  const filtered = searched.filter(s => {
    if (status === 'active') return isActiveSubscriber(s)
    if (status === 'unsubscribed') return !isActiveSubscriber(s)
    return true
  })

  // Export ignores the status filter on purpose — it is always the active,
  // search-matched list, so switching to "Unsubscribed" to review opt-outs
  // can't produce a CSV of people who asked not to be mailed.
  const exportable = searched.filter(isActiveSubscriber)

  const now = new Date()
  const active = (subscribers ?? []).filter(isActiveSubscriber)
  const stats = {
    active: active.length,
    unsubscribed: (subscribers?.length ?? 0) - active.length,
    // New sign-ups this month, counting only people still on the list.
    newThisMonth: active.filter(s => {
      if (!s.subscribed_at) return false
      const d = new Date(s.subscribed_at)
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
    }).length,
  }

  return (
    <AdminLayout>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div className="flex items-center gap-3">
          <Newspaper size={22} className="text-gold" />
          <h1 className="font-heading text-2xl font-bold text-white">Newsletter</h1>
        </div>
        <div className="self-start sm:self-auto sm:text-right">
          <button
            onClick={() => exportCsv(exportable)}
            disabled={exportable.length === 0}
            title="Downloads active subscribers only — unsubscribed people are never included."
            className="btn-gold text-sm inline-flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download size={16} />
            Export CSV ({exportable.length})
          </button>
          <p className="text-muted text-xs mt-2">Active subscribers only</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Active Subscribers', value: stats.active },
          { label: 'New This Month', value: stats.newThisMonth },
          { label: 'Unsubscribed', value: stats.unsubscribed },
        ].map(s => (
          <div key={s.label} className="bg-surface border border-border rounded-xl p-5">
            <p className="text-muted text-xs uppercase tracking-widest mb-2">{s.label}</p>
            <p className="font-heading text-2xl font-bold text-white">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Search + status filter */}
      <div className="flex flex-col md:flex-row md:items-center gap-4 mb-6">
        <div className="relative">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
          <input
            className="input-base pl-10 w-full md:w-80"
            placeholder="Search by name or email..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          {STATUS_FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setStatus(f.key)}
              className={`text-xs uppercase tracking-widest px-4 py-2 rounded-lg border transition-colors ${
                status === f.key
                  ? 'border-gold text-gold bg-gold/10'
                  : 'border-border text-muted hover:text-white'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Subscriber list */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-muted">Loading subscribers...</div>
        ) : isError ? (
          <div className="p-10 text-center">
            <AlertTriangle size={28} className="text-red-400 mx-auto mb-3" />
            <p className="text-white text-sm mb-5">
              Couldn't load subscribers. Please check your connection and try again.
            </p>
            <button onClick={() => refetch()} className="btn-gold text-sm">
              Retry
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-muted">
            {search
              ? 'No subscribers match your search.'
              : status === 'unsubscribed'
                ? 'Nobody has unsubscribed.'
                : status === 'active'
                  ? 'No active subscribers yet.'
                  : 'No subscribers yet.'}
          </div>
        ) : (
          filtered.map(s => {
            const isActive = isActiveSubscriber(s)
            return (
              <div
                key={s.id}
                className={`border-b border-border/50 last:border-0 px-5 py-4 hover:bg-background/50 transition-colors animate-fade ${
                  isActive ? '' : 'opacity-60'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1 sm:gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-white font-medium text-sm">{fullName(s) || '—'}</p>
                      {!isActive && (
                        <span className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full border border-border text-muted">
                          Unsubscribed
                        </span>
                      )}
                    </div>
                    {isActive ? (
                      <a
                        href={`mailto:${s.email}`}
                        className="text-gold text-xs hover:underline break-all"
                      >
                        {s.email}
                      </a>
                    ) : (
                      // No mailto for opted-out people — the whole point is
                      // that this address does not get mailed again.
                      <span className="text-muted text-xs break-all">{s.email}</span>
                    )}
                  </div>
                  <div className="sm:text-right flex-shrink-0">
                    <p className="text-muted text-xs">{formatDate(s.subscribed_at)}</p>
                    {!isActive && (
                      <p className="text-muted text-[11px] mt-0.5">
                        Opted out {formatDate(s.unsubscribed_at)}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </AdminLayout>
  )
}
