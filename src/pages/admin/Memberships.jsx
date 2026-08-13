import { useEffect, useState } from 'react'
import {
  Crown, Search, Check, X, Clock, AlertTriangle, Plus, UserPlus,
  ChevronDown, ChevronRight, Edit2, ToggleLeft, ToggleRight, RefreshCw, Link2,
} from 'lucide-react'
import AdminLayout from '../../components/admin/AdminLayout'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'
import MembershipForm from '../../components/admin/MembershipForm'
import TierForm from '../../components/admin/TierForm'
import {
  useMemberships, useUpdateMembershipStatus, useLinkMembershipUser,
  useAllMembershipTiers, useUpdateMembershipTier,
} from '../../hooks/useMemberships'
import { formatZAR } from '../../utils/formatCurrency'
import toast from 'react-hot-toast'

const STATUS_STYLES = {
  active:    'bg-green-500/10 text-green-400 border border-green-500/20',
  pending:   'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20',
  expired:   'bg-muted/10 text-muted border border-border',
  // Auto-expired: status column still says 'active' but expires_at has
  // passed — visually distinct from a manually-set 'expired'.
  lapsed:    'bg-orange-500/10 text-orange-400 border border-orange-500/20',
  cancelled: 'bg-red-500/10 text-red-400 border border-red-500/20',
}

const STATUS_FILTERS = ['all', 'pending', 'active', 'expired', 'cancelled']

// Client-side mirror of the membership_effective_status computed column:
// 'active' past its expires_at reads as 'expired'.
function effectiveStatus(m) {
  if (m.status === 'active' && m.expires_at && new Date(m.expires_at) < new Date()) return 'expired'
  return m.status
}

function isAutoExpired(m) {
  return m.status === 'active' && effectiveStatus(m) === 'expired'
}

// Effectively-active membership whose expires_at falls within the next 7 days.
function isExpiringSoon(m) {
  if (effectiveStatus(m) !== 'active' || !m.expires_at) return false
  return new Date(m.expires_at).getTime() <= Date.now() + 7 * 24 * 60 * 60 * 1000
}

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString('en-ZA') : '—'
}

function fmtDateTime(d) {
  return d ? new Date(d).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
}

export default function AdminMemberships() {
  const { data: memberships, isLoading, isError, refetch } = useMemberships()
  const { data: tiers, isLoading: tiersLoading, isError: tiersError, refetch: refetchTiers } = useAllMembershipTiers()
  const updateStatus = useUpdateMembershipStatus()
  const updateTier = useUpdateMembershipTier()
  const linkUser = useLinkMembershipUser()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [expandedId, setExpandedId] = useState(null)
  const [walkInOpen, setWalkInOpen] = useState(false)
  const [tierModalOpen, setTierModalOpen] = useState(false)
  const [editTier, setEditTier] = useState(null)
  // Row being linked to an account, plus the email being tried (defaults to
  // the membership's own — the walk-in usually signs up with that address).
  const [linkTarget, setLinkTarget] = useState(null)
  const [linkEmail, setLinkEmail] = useState('')

  useEffect(() => {
    document.title = 'Memberships | 224 Admin'
  }, [])

  const tierName = (slug) => tiers?.find(t => t.slug === slug)?.name ?? slug

  const filtered = (memberships ?? []).filter(m => {
    const q = search.toLowerCase()
    const matchesSearch =
      m.full_name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)
    const matchesStatus = statusFilter === 'all' || effectiveStatus(m) === statusFilter
    return matchesSearch && matchesStatus
  })

  const stats = {
    total: memberships?.length ?? 0,
    active: memberships?.filter(m => effectiveStatus(m) === 'active').length ?? 0,
    pending: memberships?.filter(m => m.status === 'pending').length ?? 0,
    expiring: memberships?.filter(isExpiringSoon).length ?? 0,
    revenue: memberships
      ?.filter(m => effectiveStatus(m) === 'active')
      .reduce((s, m) => s + m.amount, 0) ?? 0,
  }

  // `m` (the row being acted on) is only needed for approvals: the hook uses
  // it to send the confirmation email without another fetch.
  async function handleStatus(id, status, m) {
    try {
      await updateStatus.mutateAsync({
        id,
        status,
        member: m ? { name: m.full_name, email: m.email, tierName: tierName(m.tier) } : undefined,
      })
      toast.success(`Membership ${status}`)
    } catch (err) {
      toast.error(err.message || 'Update failed')
    }
  }

  async function handleToggleTier(tier) {
    try {
      await updateTier.mutateAsync({ id: tier.id, payload: { is_active: !tier.is_active } })
      toast.success(tier.is_active ? `${tier.name} deactivated` : `${tier.name} activated`)
    } catch (err) {
      toast.error(err.message || 'Update failed')
    }
  }

  function openLink(m) {
    setLinkTarget(m)
    setLinkEmail(m.email ?? '')
  }

  function closeLink() {
    setLinkTarget(null)
    setLinkEmail('')
  }

  async function handleLink(e) {
    e.preventDefault()
    if (!linkTarget) return
    try {
      await linkUser.mutateAsync({ id: linkTarget.id, email: linkEmail.trim() })
      toast.success(`Linked to ${linkEmail.trim()}`)
      closeLink()
    } catch (err) {
      toast.error(err.message || 'Link failed')
    }
  }

  const openAddTier = () => { setEditTier(null); setTierModalOpen(true) }
  const openEditTier = (tier) => { setEditTier(tier); setTierModalOpen(true) }

  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <Crown size={22} className="text-gold" />
          <h1 className="font-heading text-2xl font-bold text-white">Memberships</h1>
        </div>
        <button onClick={() => setWalkInOpen(true)} className="btn-gold flex items-center gap-2 text-sm">
          <UserPlus size={16} /> Add Walk-in Member
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        {[
          { label: 'Total Applications', value: stats.total },
          { label: 'Active Members', value: stats.active },
          { label: 'Pending Review', value: stats.pending },
          { label: 'Expiring in 7 Days', value: stats.expiring },
          { label: 'Active Revenue', value: formatZAR(stats.revenue) },
        ].map(s => (
          <div key={s.label} className="bg-surface border border-border rounded-xl p-5">
            <p className="text-muted text-xs uppercase tracking-widest mb-2">{s.label}</p>
            <p className="font-heading text-2xl font-bold text-white">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filters + search */}
      <div className="flex flex-col md:flex-row md:items-center gap-4 mb-6">
        <div className="flex gap-2 flex-wrap">
          {STATUS_FILTERS.map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-4 py-1.5 rounded-full text-xs font-medium uppercase tracking-wide transition-all border ${
                statusFilter === s
                  ? 'border-gold text-gold bg-gold/10'
                  : 'border-border text-muted hover:border-muted hover:text-white'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="relative md:ml-auto">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
          <input
            className="input-base pl-10 w-full md:w-80"
            placeholder="Search by name or email..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Members table */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden mb-10">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {['Member', 'Tier', 'Status', 'Amount', 'Expires', 'Actions', ''].map((h, i) => (
                  <th key={i} className="text-left text-xs text-muted uppercase tracking-widest px-5 py-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={7} className="text-center text-muted py-12">Loading...</td></tr>
              ) : isError ? (
                <tr><td colSpan={7} className="py-12">
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
                <tr><td colSpan={7} className="text-center text-muted py-12">No memberships found.</td></tr>
              ) : filtered.map(m => {
                const eff = effectiveStatus(m)
                const lapsed = isAutoExpired(m)
                return (
                  <MemberRow
                    key={m.id}
                    m={m}
                    eff={eff}
                    lapsed={lapsed}
                    tierName={tierName}
                    expanded={expandedId === m.id}
                    onToggle={() => setExpandedId(id => id === m.id ? null : m.id)}
                    onStatus={handleStatus}
                    onLink={openLink}
                  />
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Tier management */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-heading text-xl font-bold text-white">Membership Tiers</h2>
          <p className="text-muted text-sm mt-1">
            Pricing and duration for new applications. Tiers can't be deleted — deactivate instead
            (existing memberships reference them).
          </p>
        </div>
        <button onClick={openAddTier} className="btn-outline flex items-center gap-2 text-sm">
          <Plus size={16} /> Add Tier
        </button>
      </div>

      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {['Tier', 'Price', 'Duration', 'Sort', 'Active', 'Actions'].map(h => (
                  <th key={h} className="text-left text-xs text-muted uppercase tracking-widest px-5 py-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tiersLoading ? (
                <tr><td colSpan={6} className="text-center text-muted py-10">Loading...</td></tr>
              ) : tiersError ? (
                <tr><td colSpan={6} className="py-10">
                  <div className="text-center">
                    <AlertTriangle size={28} className="text-red-400 mx-auto mb-3" />
                    <p className="text-white text-sm mb-5">
                      Couldn't load tiers. Please check your connection and try again.
                    </p>
                    <button onClick={() => refetchTiers()} className="btn-gold text-sm">
                      Retry
                    </button>
                  </div>
                </td></tr>
              ) : (tiers ?? []).length === 0 ? (
                <tr><td colSpan={6} className="text-center text-muted py-10">No tiers yet.</td></tr>
              ) : tiers.map(t => (
                <tr key={t.id} className="border-b border-border/50 last:border-0 hover:bg-background/50 transition-colors">
                  <td className="px-5 py-4">
                    <p className="text-white font-medium text-sm">{t.name}</p>
                    <p className="font-mono text-gold text-xs mt-0.5">{t.slug}</p>
                  </td>
                  <td className="px-5 py-4 text-white text-sm">{formatZAR(t.price_cents)}</td>
                  <td className="px-5 py-4 text-muted text-sm">
                    {t.duration_days} day{t.duration_days === 1 ? '' : 's'}
                  </td>
                  <td className="px-5 py-4 text-muted text-sm">{t.sort_order}</td>
                  <td className="px-5 py-4">
                    <button
                      onClick={() => handleToggleTier(t)}
                      className={`transition-colors ${t.is_active ? 'text-green-400 hover:text-red-400' : 'text-muted hover:text-green-400'}`}
                      title={t.is_active ? 'Deactivate tier' : 'Activate tier'}
                    >
                      {t.is_active ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                    </button>
                  </td>
                  <td className="px-5 py-4">
                    <button onClick={() => openEditTier(t)} className="text-muted hover:text-gold transition-colors p-1" title="Edit tier">
                      <Edit2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Walk-in member modal */}
      <Modal isOpen={walkInOpen} onClose={() => setWalkInOpen(false)} title="Add Walk-in Member">
        <MembershipForm onClose={() => setWalkInOpen(false)} />
      </Modal>

      {/* Link membership to a customer account */}
      <Modal isOpen={!!linkTarget} onClose={closeLink} title="Link to Account" size="sm">
        <form onSubmit={handleLink} className="space-y-5">
          <p className="text-muted text-sm">
            This membership isn't attached to an online account, so
            <span className="text-white"> {linkTarget?.full_name} </span>
            can't see it on the site or buy member-only products. Enter the email
            they signed up with — the account must already exist.
          </p>
          <div>
            <label className="block text-muted text-xs uppercase tracking-widest mb-1.5">
              Account Email *
            </label>
            <input
              required
              type="email"
              maxLength={320}
              className="input-base text-sm"
              value={linkEmail}
              onChange={e => setLinkEmail(e.target.value)}
              placeholder="member@example.com"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={closeLink}>Cancel</Button>
            <Button type="submit" disabled={linkUser.isPending}>
              {linkUser.isPending ? 'Linking...' : 'Link Account'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Tier modal */}
      <Modal isOpen={tierModalOpen} onClose={() => setTierModalOpen(false)} title={editTier ? 'Edit Tier' : 'Add Tier'}>
        <TierForm tier={editTier} onClose={() => setTierModalOpen(false)} />
      </Modal>
    </AdminLayout>
  )
}

function MemberRow({ m, eff, lapsed, tierName, expanded, onToggle, onStatus, onLink }) {
  const badgeStyle = STATUS_STYLES[lapsed ? 'lapsed' : eff] ?? ''
  return (
    <>
      <tr className="border-b border-border/50 hover:bg-background/50 transition-colors animate-fade">
        <td className="px-5 py-4">
          <p className="text-white font-medium text-sm">{m.full_name}</p>
          <p className="text-muted text-xs mt-0.5">{m.email}</p>
          <p className="text-muted text-xs">{m.phone}</p>
        </td>
        <td className="px-5 py-4">
          <span className="text-white text-sm">{tierName(m.tier)}</span>
        </td>
        <td className="px-5 py-4">
          <span
            className={`text-xs px-2.5 py-1 rounded-full whitespace-nowrap ${badgeStyle}`}
            title={lapsed ? 'Auto-expired: still marked active but past its expiry date' : undefined}
          >
            {lapsed ? 'expired (auto)' : eff}
          </span>
        </td>
        <td className="px-5 py-4 text-white text-sm">{formatZAR(m.amount)}</td>
        <td className="px-5 py-4 text-muted text-sm">{fmtDate(m.expires_at)}</td>
        <td className="px-5 py-4">
          <div className="flex gap-2">
            {/* Gated on EFFECTIVE status, not the raw column: a lapsed row
                still says 'active' but is expired everywhere it counts, and
                that member renewing at the door needs this button. */}
            {eff !== 'active' && (
              <button
                onClick={() => onStatus(m.id, 'active', m)}
                className="p-1.5 rounded-lg bg-green-500/10 text-green-400 hover:bg-green-500/20 transition-colors"
                title={lapsed
                  ? 'Renew (restarts the membership clock from now)'
                  : 'Approve & activate (starts the membership clock)'}
                aria-label={lapsed ? 'Renew membership' : 'Approve and activate membership'}
              >
                {lapsed ? <RefreshCw size={14} /> : <Check size={14} />}
              </button>
            )}
            {!m.user_id && (
              <button
                onClick={() => onLink(m)}
                className="p-1.5 rounded-lg bg-gold/10 text-gold hover:bg-gold/20 transition-colors"
                title="Link to a customer account (needed for online member-only access)"
                aria-label="Link membership to a customer account"
              >
                <Link2 size={14} />
              </button>
            )}
            {m.status !== 'cancelled' && (
              <button
                onClick={() => onStatus(m.id, 'cancelled')}
                className="p-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                title="Cancel"
              >
                <X size={14} />
              </button>
            )}
            {m.status !== 'expired' && (
              <button
                onClick={() => onStatus(m.id, 'expired')}
                className="p-1.5 rounded-lg bg-muted/10 text-muted hover:bg-muted/20 transition-colors"
                title="Mark Expired"
              >
                <Clock size={14} />
              </button>
            )}
          </div>
        </td>
        <td className="px-5 py-4">
          <button onClick={onToggle} className="text-muted hover:text-white transition-colors" aria-label="Toggle membership details">
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-border/50 bg-background/50">
          <td colSpan={7} className="px-5 pb-6 pt-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h4 className="text-gold text-xs uppercase tracking-widest mb-3">Member Details</h4>
                <div className="space-y-1 text-sm">
                  <p className="text-muted">Date of Birth: <span className="text-white">{fmtDate(m.date_of_birth)}</span></p>
                  <p className="text-muted">ID Number: <span className="text-white">{m.id_number || '—'}</span></p>
                  <p className="text-muted">Applied: <span className="text-white">{fmtDateTime(m.created_at)}</span></p>
                  <p className="text-muted">Approved: <span className="text-white">{fmtDateTime(m.approved_at)}</span></p>
                  <p className="text-muted">Starts: <span className="text-white">{fmtDateTime(m.starts_at)}</span></p>
                  <p className="text-muted">Expires: <span className="text-white">{fmtDateTime(m.expires_at)}</span></p>
                  <p className="text-muted">
                    Account:{' '}
                    <span className={m.user_id ? 'text-white' : 'text-orange-400'}>
                      {m.user_id ? 'Linked' : 'Not linked — no online access'}
                    </span>
                  </p>
                  {m.paystack_reference && (
                    <p className="text-muted">Ref: <span className="font-mono text-gold text-xs">{m.paystack_reference}</span></p>
                  )}
                </div>
              </div>
              <div>
                <h4 className="text-gold text-xs uppercase tracking-widest mb-3">Status History</h4>
                {Array.isArray(m.status_history) && m.status_history.length > 0 ? (
                  <div className="space-y-2">
                    {m.status_history.map((h, i) => (
                      <div key={i} className="flex items-center gap-3 text-sm">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLES[h.status] ?? 'bg-muted/10 text-muted border border-border'}`}>
                          {h.status}
                        </span>
                        <span className="text-white">{fmtDateTime(h.at)}</span>
                        <span className="text-muted text-xs font-mono">
                          {h.actor ? `by ${String(h.actor).slice(0, 8)}…` : ''}
                        </span>
                        {h.note && <span className="text-muted text-xs">{h.note}</span>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted text-sm">No history recorded (pre-migration row).</p>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
