import { useEffect, useState } from 'react'
import { Newspaper, Search, AlertTriangle, Download } from 'lucide-react'
import AdminLayout from '../../components/admin/AdminLayout'
import { useNewsletterSubscribers } from '../../hooks/useNewsletterSubscribers'

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

function exportCsv(subscribers) {
  const header = 'email,first_name,last_name,subscribed_at'
  const rows = subscribers.map(s =>
    [s.email, s.first_name, s.last_name, s.subscribed_at].map(csvField).join(',')
  )
  const csv = [header, ...rows].join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `newsletter-subscribers-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export default function AdminNewsletter() {
  const { data: subscribers, isLoading, isError, refetch } = useNewsletterSubscribers()
  const [search, setSearch] = useState('')

  useEffect(() => {
    document.title = 'Newsletter | 224 Admin'
  }, [])

  const q = search.toLowerCase()
  const filtered = (subscribers ?? []).filter(s =>
    fullName(s).toLowerCase().includes(q) ||
    s.email.toLowerCase().includes(q)
  )

  const now = new Date()
  const stats = {
    total: subscribers?.length ?? 0,
    newThisMonth: (subscribers ?? []).filter(s => {
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
        <button
          onClick={() => exportCsv(filtered)}
          disabled={filtered.length === 0}
          className="btn-gold text-sm inline-flex items-center gap-2 self-start sm:self-auto disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Download size={16} />
          Export CSV
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Total Subscribers', value: stats.total },
          { label: 'New This Month', value: stats.newThisMonth },
        ].map(s => (
          <div key={s.label} className="bg-surface border border-border rounded-xl p-5">
            <p className="text-muted text-xs uppercase tracking-widest mb-2">{s.label}</p>
            <p className="font-heading text-2xl font-bold text-white">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
        <input
          className="input-base pl-10 w-full md:w-80"
          placeholder="Search by name or email..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
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
            {search ? 'No subscribers match your search.' : 'No subscribers yet.'}
          </div>
        ) : (
          filtered.map(s => (
            <div
              key={s.id}
              className="border-b border-border/50 last:border-0 px-5 py-4 hover:bg-background/50 transition-colors animate-fade"
            >
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1 sm:gap-4">
                <div className="min-w-0">
                  <p className="text-white font-medium text-sm">{fullName(s) || '—'}</p>
                  <a
                    href={`mailto:${s.email}`}
                    className="text-gold text-xs hover:underline break-all"
                  >
                    {s.email}
                  </a>
                </div>
                <p className="text-muted text-xs flex-shrink-0">{formatDate(s.subscribed_at)}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </AdminLayout>
  )
}
