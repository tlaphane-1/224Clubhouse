import { useEffect, useState } from 'react'
import { Mail, Search, AlertTriangle } from 'lucide-react'
import AdminLayout from '../../components/admin/AdminLayout'
import { useContactMessages } from '../../hooks/useContactMessages'

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

export default function AdminMessages() {
  const { data: messages, isLoading, isError, refetch } = useContactMessages()
  const [search, setSearch] = useState('')

  useEffect(() => {
    document.title = 'Messages | 224 Admin'
  }, [])

  const q = search.toLowerCase()
  const filtered = (messages ?? []).filter(m =>
    m.name.toLowerCase().includes(q) ||
    m.email.toLowerCase().includes(q) ||
    m.message.toLowerCase().includes(q)
  )

  const stats = {
    total: messages?.length ?? 0,
    senders: new Set((messages ?? []).map(m => m.email.toLowerCase())).size,
  }

  return (
    <AdminLayout>
      <div className="flex items-center gap-3 mb-8">
        <Mail size={22} className="text-gold" />
        <h1 className="font-heading text-2xl font-bold text-white">Messages</h1>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Total Messages', value: stats.total },
          { label: 'Unique Senders', value: stats.senders },
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
          placeholder="Search by name, email or message..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Message list */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-muted">Loading messages...</div>
        ) : isError ? (
          <div className="p-10 text-center">
            <AlertTriangle size={28} className="text-red-400 mx-auto mb-3" />
            <p className="text-white text-sm mb-5">
              Couldn't load messages. Please check your connection and try again.
            </p>
            <button onClick={() => refetch()} className="btn-gold text-sm">
              Retry
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-muted">
            {search ? 'No messages match your search.' : 'No messages yet.'}
          </div>
        ) : (
          filtered.map(m => (
            <div
              key={m.id}
              className="border-b border-border/50 last:border-0 px-5 py-4 hover:bg-background/50 transition-colors animate-fade"
            >
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1 sm:gap-4">
                <div className="min-w-0">
                  <p className="text-white font-medium text-sm">{m.name}</p>
                  <a
                    href={`mailto:${m.email}${m.subject ? `?subject=${encodeURIComponent(`Re: ${m.subject}`)}` : ''}`}
                    className="text-gold text-xs hover:underline break-all"
                  >
                    {m.email}
                  </a>
                </div>
                <p className="text-muted text-xs flex-shrink-0">{formatDate(m.created_at)}</p>
              </div>
              {m.subject && (
                <p className="text-white text-sm mt-2 font-medium">{m.subject}</p>
              )}
              <p className="text-muted text-sm mt-1 whitespace-pre-wrap break-words">{m.message}</p>
            </div>
          ))
        )}
      </div>
    </AdminLayout>
  )
}
