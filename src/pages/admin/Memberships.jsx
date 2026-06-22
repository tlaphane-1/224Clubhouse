import { useState } from 'react'
import { Crown, Search, Check, X, Clock, AlertTriangle } from 'lucide-react'
import AdminLayout from '../../components/admin/AdminLayout'
import { useMemberships, useUpdateMembershipStatus } from '../../hooks/useMemberships'
import toast from 'react-hot-toast'

const STATUS_STYLES = {
  active:    'bg-green-500/10 text-green-400 border border-green-500/20',
  pending:   'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20',
  expired:   'bg-muted/10 text-muted border border-border',
  cancelled: 'bg-red-500/10 text-red-400 border border-red-500/20',
}

const TIER_LABELS = { daily: 'Daily Pass', weekly: 'Weekly', monthly: 'Monthly' }

export default function AdminMemberships() {
  const { data: memberships, isLoading, isError, refetch } = useMemberships()
  const updateStatus = useUpdateMembershipStatus()
  const [search, setSearch] = useState('')

  const filtered = (memberships ?? []).filter(m =>
    m.full_name.toLowerCase().includes(search.toLowerCase()) ||
    m.email.toLowerCase().includes(search.toLowerCase())
  )

  const stats = {
    total: memberships?.length ?? 0,
    active: memberships?.filter(m => m.status === 'active').length ?? 0,
    pending: memberships?.filter(m => m.status === 'pending').length ?? 0,
    revenue: memberships?.filter(m => m.status === 'active').reduce((s, m) => s + m.amount, 0) ?? 0,
  }

  async function handleStatus(id, status) {
    try {
      await updateStatus.mutateAsync({ id, status })
      toast.success(`Membership ${status}`)
    } catch {
      toast.error('Update failed')
    }
  }

  return (
    <AdminLayout>
      <div className="flex items-center gap-3 mb-8">
        <Crown size={22} className="text-gold" />
        <h1 className="font-heading text-2xl font-bold text-white">Memberships</h1>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Total Applications', value: stats.total },
          { label: 'Active Members', value: stats.active },
          { label: 'Pending Review', value: stats.pending },
          { label: 'Active Revenue', value: `R${(stats.revenue / 100).toFixed(0)}` },
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

      {/* Table */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {['Member', 'Tier', 'Status', 'Amount', 'Expires', 'Actions'].map(h => (
                  <th key={h} className="text-left text-xs text-muted uppercase tracking-widest px-5 py-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={6} className="text-center text-muted py-12">Loading...</td></tr>
              ) : isError ? (
                <tr><td colSpan={6} className="py-12">
                  <div className="text-center">
                    <AlertTriangle size={28} className="text-red-400 mx-auto mb-3" />
                    <p className="text-white text-sm mb-5">
                      Couldn't load memberships. Please check your connection and try again.
                    </p>
                    <button onClick={() => refetch()} className="btn-gold text-sm">
                      Retry
                    </button>
                  </div>
                </td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} className="text-center text-muted py-12">No memberships found.</td></tr>
              ) : filtered.map(m => (
                <tr
                  key={m.id}
                  className="border-b border-border/50 hover:bg-background/50 transition-colors animate-fade"
                >
                  <td className="px-5 py-4">
                    <p className="text-white font-medium text-sm">{m.full_name}</p>
                    <p className="text-muted text-xs mt-0.5">{m.email}</p>
                    <p className="text-muted text-xs">{m.phone}</p>
                  </td>
                  <td className="px-5 py-4">
                    <span className="text-white text-sm">{TIER_LABELS[m.tier] ?? m.tier}</span>
                  </td>
                  <td className="px-5 py-4">
                    <span className={`text-xs px-2.5 py-1 rounded-full ${STATUS_STYLES[m.status] ?? ''}`}>
                      {m.status}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-white text-sm">
                    R{(m.amount / 100).toFixed(0)}
                  </td>
                  <td className="px-5 py-4 text-muted text-sm">
                    {m.expires_at ? new Date(m.expires_at).toLocaleDateString('en-ZA') : '—'}
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex gap-2">
                      {m.status !== 'active' && (
                        <button
                          onClick={() => handleStatus(m.id, 'active')}
                          className="p-1.5 rounded-lg bg-green-500/10 text-green-400 hover:bg-green-500/20 transition-colors"
                          title="Activate"
                        >
                          <Check size={14} />
                        </button>
                      )}
                      {m.status !== 'cancelled' && (
                        <button
                          onClick={() => handleStatus(m.id, 'cancelled')}
                          className="p-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                          title="Cancel"
                        >
                          <X size={14} />
                        </button>
                      )}
                      {m.status !== 'expired' && (
                        <button
                          onClick={() => handleStatus(m.id, 'expired')}
                          className="p-1.5 rounded-lg bg-muted/10 text-muted hover:bg-muted/20 transition-colors"
                          title="Mark Expired"
                        >
                          <Clock size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AdminLayout>
  )
}
