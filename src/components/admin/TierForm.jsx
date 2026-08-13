import { useState } from 'react'
import Button from '../ui/Button'
import toast from 'react-hot-toast'
import { slugify } from '../../utils/slugify'
import { useCreateMembershipTier, useUpdateMembershipTier } from '../../hooks/useMemberships'

const defaultForm = {
  name: '', price: '', duration_days: '', sort_order: '0', perksText: '', is_active: true,
}

export default function TierForm({ tier, onClose }) {
  const [form, setForm] = useState(tier ? {
    name: tier.name,
    // Same rands-in-the-form, cents-in-the-DB convention as ProductForm.
    price: (tier.price_cents / 100).toFixed(2),
    duration_days: String(tier.duration_days),
    sort_order: String(tier.sort_order ?? 0),
    perksText: Array.isArray(tier.perks) ? tier.perks.join('\n') : '',
    is_active: tier.is_active,
  } : defaultForm)
  const [saving, setSaving] = useState(false)
  const createTier = useCreateMembershipTier()
  const updateTier = useUpdateMembershipTier()

  const set = (key, value) => setForm(f => ({ ...f, [key]: value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        // Slug is the stable identifier RPCs price against — generated once
        // on create, never rewritten on edit (mirrors ProductForm's slug rule).
        slug: tier ? tier.slug : slugify(form.name),
        price_cents: Math.round(parseFloat(form.price) * 100),
        duration_days: parseInt(form.duration_days, 10),
        sort_order: parseInt(form.sort_order, 10) || 0,
        perks: form.perksText.split('\n').map(p => p.trim()).filter(Boolean),
        is_active: form.is_active,
      }
      if (tier) {
        await updateTier.mutateAsync({ id: tier.id, payload })
        toast.success('Tier updated')
      } else {
        await createTier.mutateAsync(payload)
        toast.success('Tier created')
      }
      onClose()
    } catch (err) {
      toast.error(err.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'input-base text-sm'
  const labelCls = 'block text-muted text-xs uppercase tracking-widest mb-1.5'

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label className={labelCls}>Tier Name *</label>
        <input required maxLength={100} className={inputCls} value={form.name}
          onChange={e => set('name', e.target.value)} placeholder="e.g. Monthly Member" />
        <p className="text-muted text-xs mt-1.5">
          {tier
            ? <>Slug: <span className="font-mono text-gold">{tier.slug}</span> (fixed — memberships reference it)</>
            : <>Slug is generated from the name: <span className="font-mono text-gold">{slugify(form.name) || '…'}</span></>}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className={labelCls}>Price (Rands) *</label>
          <input required type="number" min="0" step="0.01" className={inputCls} value={form.price}
            onChange={e => set('price', e.target.value)} placeholder="50.00" />
        </div>
        <div>
          <label className={labelCls}>Duration (days) *</label>
          <input required type="number" min="1" className={inputCls} value={form.duration_days}
            onChange={e => set('duration_days', e.target.value)} placeholder="30" />
        </div>
        <div>
          <label className={labelCls}>Sort Order</label>
          <input type="number" className={inputCls} value={form.sort_order}
            onChange={e => set('sort_order', e.target.value)} placeholder="0" />
        </div>
      </div>

      <div>
        <label className={labelCls}>Perks (one per line)</label>
        <textarea rows={5} className={inputCls} value={form.perksText}
          onChange={e => set('perksText', e.target.value)}
          placeholder={'30-day lounge access\nPriority event invitations\nMember-only discounts'} />
      </div>

      <label className="flex items-center gap-2 cursor-pointer w-fit">
        <div
          onClick={() => set('is_active', !form.is_active)}
          className={`w-10 h-6 rounded-full transition-colors cursor-pointer ${form.is_active ? 'bg-gold' : 'bg-border'} relative`}
        >
          <span className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${form.is_active ? 'left-5' : 'left-1'}`} />
        </div>
        <span className="text-muted text-sm">Active (visible on the public pricing page)</span>
      </label>

      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? 'Saving...' : tier ? 'Update Tier' : 'Add Tier'}</Button>
      </div>
    </form>
  )
}
