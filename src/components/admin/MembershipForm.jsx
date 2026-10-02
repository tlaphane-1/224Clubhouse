import { useState } from 'react'
import Button from '../ui/Button'
import toast from 'react-hot-toast'
import { useAdminCreateMembership, useAllMembershipTiers } from '../../hooks/useMemberships'
import { formatZAR } from '../../utils/formatCurrency'

const defaultForm = {
  full_name: '', email: '', phone: '', date_of_birth: '', id_number: '', tier_slug: '',
}

// Latest date of birth that still makes someone 21 today (mirrors the
// `current_date - interval '21 years'` check inside admin_create_membership).
// Built from local date parts, not toISOString(): SAST is UTC+2, so before
// 02:00 the UTC date is still yesterday and a member born exactly 21 years
// ago today would be rejected.
function maxDobFor21() {
  const d = new Date()
  d.setFullYear(d.getFullYear() - 21)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

export default function MembershipForm({ onClose }) {
  const { data: tiers } = useAllMembershipTiers()
  const createMembership = useAdminCreateMembership()
  const [form, setForm] = useState(defaultForm)
  const [saving, setSaving] = useState(false)

  const activeTiers = (tiers ?? []).filter(t => t.is_active)
  const set = (key, value) => setForm(f => ({ ...f, [key]: value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    // Client-side 21+ gate; the RPC enforces the same rule server-side.
    if (form.date_of_birth > maxDobFor21()) {
      toast.error('Member must be 21 or older')
      return
    }
    setSaving(true)
    try {
      await createMembership.mutateAsync({
        customer: {
          full_name: form.full_name.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
          date_of_birth: form.date_of_birth,
          id_number: form.id_number.trim() || null,
        },
        tierSlug: form.tier_slug,
      })
      toast.success('Walk-in member created — membership is active')
      onClose()
    } catch (err) {
      toast.error(err.message || 'Failed to create member')
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'input-base text-sm'
  const labelCls = 'block text-muted text-xs uppercase tracking-widest mb-1.5'

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <p className="text-muted text-sm">
        For cash-at-the-door members without an account. The membership is created
        <span className="text-white"> active immediately</span> with the clock started.
      </p>

      <div>
        <label className={labelCls}>Full Name *</label>
        <input required maxLength={200} className={inputCls} value={form.full_name}
          onChange={e => set('full_name', e.target.value)} placeholder="e.g. Thabo Mokoena" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Email *</label>
          <input required type="email" maxLength={320} className={inputCls} value={form.email}
            onChange={e => set('email', e.target.value)} placeholder="member@example.com" />
        </div>
        <div>
          <label className={labelCls}>Phone *</label>
          <input required maxLength={50} className={inputCls} value={form.phone}
            onChange={e => set('phone', e.target.value)} placeholder="082 000 0000" />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Date of Birth * (21+)</label>
          <input required type="date" max={maxDobFor21()} className={inputCls} value={form.date_of_birth}
            onChange={e => set('date_of_birth', e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>SA ID Number</label>
          <input maxLength={13} className={inputCls} value={form.id_number}
            onChange={e => set('id_number', e.target.value)} placeholder="Optional" />
        </div>
      </div>

      <div>
        <label className={labelCls}>Tier *</label>
        <select required className={inputCls} value={form.tier_slug}
          onChange={e => set('tier_slug', e.target.value)}>
          <option value="" disabled>Select a tier</option>
          {activeTiers.map(t => (
            <option key={t.id} value={t.slug}>
              {t.name} — {formatZAR(t.price_cents)} / {t.duration_days} day{t.duration_days === 1 ? '' : 's'}
            </option>
          ))}
        </select>
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? 'Creating...' : 'Create Active Member'}</Button>
      </div>
    </form>
  )
}
