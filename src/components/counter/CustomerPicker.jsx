import { useState } from 'react'
import { Search, UserPlus, X } from 'lucide-react'
import { useFindCustomers } from '../../hooks/useCounter'
import { memberBadge } from '../../utils/counter'
import CustomerHistory from './CustomerHistory'

const TONE = {
  good: 'bg-green-500/10 text-green-400 border border-green-500/20',
  warn: 'bg-gold/10 text-gold border border-gold/20',
  muted: 'bg-muted/10 text-muted border border-border',
}

function Badge({ status }) {
  const b = memberBadge(status)
  return <span className={`text-xs px-2 py-0.5 rounded-full ${TONE[b.tone]}`}>{b.label}</span>
}

const shortDate = (iso) => new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })

// Who is buying: an existing customer (search) or a walk-in (name + phone).
// `customer` is { userId?, name, phone, memberStatus?, tierName?, expiresAt? }.
export default function CustomerPicker({ customer, onChange }) {
  const [query, setQuery] = useState('')
  const [walkIn, setWalkIn] = useState(false)
  const [walkInForm, setWalkInForm] = useState({ name: '', phone: '' })
  const results = useFindCustomers(query)
  const label = 'block text-muted text-xs uppercase tracking-widest mb-1.5'

  if (customer) {
    return (
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-white font-semibold">{customer.name}</p>
            <p className="text-muted text-sm">{customer.phone}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge status={customer.memberStatus ?? 'none'} />
              {customer.memberStatus === 'active' && customer.tierName && (
                <span className="text-muted text-xs">
                  {customer.tierName}{customer.expiresAt ? ` · until ${shortDate(customer.expiresAt)}` : ''}
                </span>
              )}
            </div>
          </div>
          <button type="button" onClick={() => onChange(null)}
            className="focus-ring rounded-lg min-h-11 px-3 inline-flex items-center gap-1 text-muted hover:text-white text-xs uppercase tracking-widest">
            <X size={14} aria-hidden="true" /> Change
          </button>
        </div>
        <CustomerHistory userId={customer.userId} phone={customer.phone} />
      </div>
    )
  }

  if (walkIn) {
    const ready = walkInForm.name.trim() && walkInForm.phone.trim()
    return (
      <form className="space-y-3" onSubmit={(e) => {
        e.preventDefault()
        if (ready) onChange({ name: walkInForm.name.trim(), phone: walkInForm.phone.trim(), memberStatus: 'none' })
      }}>
        <div>
          <label htmlFor="walkin-name" className={label}>Name *</label>
          <input id="walkin-name" className="input-base text-sm" value={walkInForm.name} maxLength={80}
            onChange={e => setWalkInForm(f => ({ ...f, name: e.target.value }))} autoComplete="off" />
        </div>
        <div>
          <label htmlFor="walkin-phone" className={label}>Phone *</label>
          <input id="walkin-phone" type="tel" inputMode="tel" className="input-base text-sm" value={walkInForm.phone} maxLength={30}
            onChange={e => setWalkInForm(f => ({ ...f, phone: e.target.value }))} autoComplete="off" />
        </div>
        <div className="flex gap-2">
          <button type="submit" disabled={!ready} className="btn-gold flex-1 min-h-11">Use walk-in</button>
          <button type="button" onClick={() => setWalkIn(false)} className="btn-outline min-h-11 px-4 text-xs uppercase tracking-widest">Back</button>
        </div>
      </form>
    )
  }

  const list = results.data ?? []
  return (
    <div className="space-y-3">
      <label htmlFor="customer-search" className={label}>Find customer</label>
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
        <input id="customer-search" className="input-base text-sm pl-9" placeholder="Name, phone or email"
          value={query} onChange={e => setQuery(e.target.value)} autoComplete="off" />
      </div>
      {query.trim().length >= 2 && (
        results.isLoading ? (
          <div className="h-12 skeleton rounded-lg" aria-busy="true" />
        ) : results.isError ? (
          <p className="text-red-400 text-sm">Search failed. Check the connection and try again.</p>
        ) : list.length === 0 ? (
          <p className="text-muted text-sm">No one found. Use walk-in for a new customer.</p>
        ) : (
          <ul className="divide-y divide-border border border-border rounded-xl overflow-hidden">
            {list.map(r => (
              <li key={r.user_id ?? r.phone}>
                <button type="button"
                  onClick={() => onChange({
                    userId: r.user_id, name: r.full_name, phone: r.phone,
                    memberStatus: r.member_status, tierName: r.tier_name, expiresAt: r.expires_at,
                  })}
                  className="focus-ring w-full text-left px-4 py-3 min-h-11 hover:bg-background flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block text-white text-sm truncate">{r.full_name}</span>
                    <span className="block text-muted text-xs">{r.phone}</span>
                  </span>
                  <Badge status={r.member_status} />
                </button>
              </li>
            ))}
          </ul>
        )
      )}
      <button type="button" onClick={() => setWalkIn(true)}
        className="btn-outline w-full min-h-11 inline-flex items-center justify-center gap-2 text-xs uppercase tracking-widest">
        <UserPlus size={16} aria-hidden="true" /> Walk-in customer
      </button>
    </div>
  )
}
