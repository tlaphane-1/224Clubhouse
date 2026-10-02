import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, Edit2, ToggleLeft, ToggleRight, AlertTriangle, Ticket } from 'lucide-react'
import AdminLayout from '../../components/admin/AdminLayout'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'
import { useAdminDiscountCodes } from '../../hooks/useDiscountCode'
import { supabase } from '../../lib/supabase'
import { formatZAR } from '../../utils/formatCurrency'
import toast from 'react-hot-toast'

const emptyForm = {
  code: '',
  description: '',
  kind: 'percent',
  value: '', // % when kind=percent, RANDS when kind=fixed (converted on save)
  min_subtotal_rands: '',
  first_order_only: false,
  max_redemptions: '',
  expires_at: '', // yyyy-mm-dd, or blank for no expiry
  is_active: true,
}

// <input type="date"> wants yyyy-mm-dd; the column is timestamptz.
//
// Built from LOCAL date parts, not toISOString(): save writes the chosen day as
// `${yyyy-mm-dd}T23:59:59` in local time, so reading it back in UTC lands on the
// previous day in any UTC-negative zone — and every open-and-save of the form
// would walk the expiry a day earlier. Same class of bug as MembershipForm's
// maxDobFor21(). Local out, local in, so the round trip is a fixed point.
function toDateInput(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/**
 * What a code is worth, in words — percent codes are a percentage, fixed
 * codes are cents (money is integer cents everywhere; see CLAUDE.md).
 */
function valueLabel(row) {
  return row.kind === 'percent' ? `${row.value}% off` : `${formatZAR(row.value)} off`
}

/**
 * Mirrors discount_eval()'s validity checks so the admin sees the same
 * verdict a customer would get. Order matters: inactive wins, then the
 * window, then the redemption cap.
 */
function statusOf(row) {
  const now = new Date()
  if (!row.is_active) return { label: 'Inactive', cls: 'bg-muted/10 text-muted border-border' }
  if (row.starts_at && new Date(row.starts_at) > now) {
    return { label: 'Scheduled', cls: 'bg-blue-500/10 text-blue-400 border-blue-500/20' }
  }
  if (row.expires_at && new Date(row.expires_at) <= now) {
    return { label: 'Expired', cls: 'bg-red-500/10 text-red-400 border-red-500/20' }
  }
  if (row.max_redemptions != null && row.times_redeemed >= row.max_redemptions) {
    return { label: 'Used up', cls: 'bg-red-500/10 text-red-400 border-red-500/20' }
  }
  return { label: 'Live', cls: 'bg-green-500/10 text-green-400 border-green-500/20' }
}

function validityLabel(row) {
  const from = row.starts_at ? new Date(row.starts_at).toLocaleDateString('en-ZA') : null
  const to = row.expires_at ? new Date(row.expires_at).toLocaleDateString('en-ZA') : null
  if (from && to) return `${from} — ${to}`
  if (to) return `Until ${to}`
  if (from) return `From ${from}`
  return 'No expiry'
}

function DiscountForm({ discount, onClose }) {
  const [form, setForm] = useState(
    discount
      ? {
          code: discount.code,
          description: discount.description ?? '',
          kind: discount.kind,
          // fixed codes are stored in cents, entered in rands
          value: discount.kind === 'percent' ? String(discount.value) : (discount.value / 100).toFixed(2),
          min_subtotal_rands: discount.min_subtotal_cents ? (discount.min_subtotal_cents / 100).toFixed(2) : '',
          first_order_only: discount.first_order_only,
          max_redemptions: discount.max_redemptions == null ? '' : String(discount.max_redemptions),
          expires_at: toDateInput(discount.expires_at),
          is_active: discount.is_active,
        }
      : emptyForm,
  )
  const [saving, setSaving] = useState(false)
  const queryClient = useQueryClient()

  const set = (key, value) => setForm(f => ({ ...f, [key]: value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    const code = form.code.trim().toUpperCase()
    // Same shape the column's CHECK constraint enforces — caught here so the
    // admin gets a sentence instead of a constraint violation.
    if (!/^[A-Z0-9_-]{3,40}$/.test(code)) {
      toast.error('Code must be 3–40 characters: A–Z, 0–9, - or _ only')
      return
    }
    const rawValue = parseFloat(form.value)
    if (!Number.isFinite(rawValue) || rawValue <= 0) {
      toast.error('Enter a value greater than zero')
      return
    }
    if (form.kind === 'percent' && (rawValue < 1 || rawValue > 100 || !Number.isInteger(rawValue))) {
      toast.error('A percentage must be a whole number between 1 and 100')
      return
    }

    setSaving(true)
    try {
      const payload = {
        code,
        description: form.description.trim() || null,
        kind: form.kind,
        value: form.kind === 'percent' ? Math.round(rawValue) : Math.round(rawValue * 100),
        min_subtotal_cents: Math.round((parseFloat(form.min_subtotal_rands) || 0) * 100),
        first_order_only: form.first_order_only,
        max_redemptions: form.max_redemptions === '' ? null : parseInt(form.max_redemptions, 10),
        // End of the chosen day, so "expires 20 Aug" stays usable all of the 20th.
        expires_at: form.expires_at ? new Date(`${form.expires_at}T23:59:59`).toISOString() : null,
        is_active: form.is_active,
      }

      if (discount) {
        const { error } = await supabase.from('discount_codes').update(payload).eq('id', discount.id)
        if (error) throw error
        toast.success('Discount updated')
      } else {
        const { error } = await supabase.from('discount_codes').insert(payload)
        if (error) throw error
        toast.success('Discount created')
      }
      queryClient.invalidateQueries({ queryKey: ['discount-codes'] })
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Code *</label>
          <input
            required
            className={`${inputCls} uppercase tracking-widest`}
            value={form.code}
            onChange={e => set('code', e.target.value.toUpperCase())}
            placeholder="WELCOME10"
            maxLength={40}
          />
        </div>
        <div>
          <label className={labelCls}>Type *</label>
          <select required className={inputCls} value={form.kind} onChange={e => set('kind', e.target.value)}>
            <option value="percent">Percentage off</option>
            <option value="fixed">Fixed amount off</option>
          </select>
        </div>
      </div>

      <div>
        <label className={labelCls}>Description</label>
        <input
          className={inputCls}
          value={form.description}
          onChange={e => set('description', e.target.value)}
          placeholder="What this code is for — admins only, never shown to customers"
          maxLength={300}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>
            {form.kind === 'percent' ? 'Percentage off (%) *' : 'Amount off (Rands) *'}
          </label>
          <input
            required
            type="number"
            min={form.kind === 'percent' ? 1 : 0.01}
            max={form.kind === 'percent' ? 100 : undefined}
            step={form.kind === 'percent' ? 1 : 0.01}
            className={inputCls}
            value={form.value}
            onChange={e => set('value', e.target.value)}
            placeholder={form.kind === 'percent' ? '10' : '50.00'}
          />
        </div>
        <div>
          <label className={labelCls}>Minimum spend (Rands)</label>
          <input
            type="number"
            min="0"
            step="0.01"
            className={inputCls}
            value={form.min_subtotal_rands}
            onChange={e => set('min_subtotal_rands', e.target.value)}
            placeholder="0.00"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Max redemptions</label>
          <input
            type="number"
            min="1"
            step="1"
            className={inputCls}
            value={form.max_redemptions}
            onChange={e => set('max_redemptions', e.target.value)}
            placeholder="Leave blank for unlimited"
          />
        </div>
        <div>
          <label className={labelCls}>Expires on</label>
          <input
            type="date"
            className={inputCls}
            value={form.expires_at}
            onChange={e => set('expires_at', e.target.value)}
          />
          <p className="text-muted text-xs mt-1.5">Blank = never expires. Usable all of the chosen day.</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-6">
        {[
          { key: 'first_order_only', label: "Customer's first order only" },
          { key: 'is_active', label: 'Active' },
        ].map(({ key, label }) => (
          <label key={key} className="flex items-center gap-2 cursor-pointer">
            <div
              onClick={() => set(key, !form[key])}
              className={`w-10 h-6 rounded-full transition-colors cursor-pointer ${form[key] ? 'bg-gold' : 'bg-border'} relative`}
            >
              <span className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${form[key] ? 'left-5' : 'left-1'}`} />
            </div>
            <span className="text-muted text-sm">{label}</span>
          </label>
        ))}
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving...' : discount ? 'Update Discount' : 'Create Discount'}
        </Button>
      </div>
    </form>
  )
}

export default function Discounts() {
  const { data: codes, isLoading, isError, refetch } = useAdminDiscountCodes()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const queryClient = useQueryClient()

  useEffect(() => {
    document.title = 'Discounts | 224 Admin'
  }, [])

  // Deactivate, never delete: placed orders carry discount_code as a plain
  // text record of what was applied, and the code's redemption history is the
  // only measure of what a campaign cost. Deleting the row would erase that.
  const handleToggleActive = async (row) => {
    const { error } = await supabase
      .from('discount_codes')
      .update({ is_active: !row.is_active })
      .eq('id', row.id)
    if (error) {
      toast.error('Failed to update code')
      return
    }
    queryClient.invalidateQueries({ queryKey: ['discount-codes'] })
    toast.success(row.is_active ? `${row.code} deactivated` : `${row.code} activated`)
  }

  const openAdd = () => { setEditing(null); setModalOpen(true) }
  const openEdit = (row) => { setEditing(row); setModalOpen(true) }

  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="font-heading text-3xl font-bold text-white">Discounts</h1>
          <p className="text-muted text-sm mt-1">{codes?.length || 0} codes</p>
        </div>
        <button onClick={openAdd} className="btn-gold flex items-center gap-2 text-sm">
          <Plus size={16} /> Add Code
        </button>
      </div>

      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-muted">Loading...</div>
        ) : isError ? (
          <div className="p-10 text-center">
            <AlertTriangle size={28} className="text-red-400 mx-auto mb-3" />
            <p className="text-white text-sm mb-5">
              Couldn't load discount codes. Please check your connection and try again.
            </p>
            <button onClick={() => refetch()} className="btn-gold text-sm">Retry</button>
          </div>
        ) : (codes?.length ?? 0) === 0 ? (
          <div className="p-12 text-center">
            <Ticket size={28} className="text-muted mx-auto mb-3" />
            <p className="text-white text-sm mb-1">No discount codes yet</p>
            <p className="text-muted text-xs mb-5">
              Create one and customers can enter it at checkout.
            </p>
            <button onClick={openAdd} className="btn-gold text-sm">Add Code</button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted uppercase tracking-widest text-xs">
                  <th className="p-4 text-left font-medium">Code</th>
                  <th className="p-4 text-left font-medium">Value</th>
                  <th className="p-4 text-left font-medium">Conditions</th>
                  <th className="p-4 text-left font-medium">Validity</th>
                  <th className="p-4 text-right font-medium">Used</th>
                  <th className="p-4 text-center font-medium">Status</th>
                  <th className="p-4 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {codes.map(row => {
                  const status = statusOf(row)
                  return (
                    <tr key={row.id} className="hover:bg-border/20 transition-colors">
                      <td className="p-4">
                        <p className="text-white font-semibold tracking-widest">{row.code}</p>
                        {row.description && (
                          <p className="text-muted text-xs mt-0.5 max-w-xs truncate">{row.description}</p>
                        )}
                      </td>
                      <td className="p-4 text-gold whitespace-nowrap">{valueLabel(row)}</td>
                      <td className="p-4 text-muted text-xs">
                        {row.min_subtotal_cents > 0 && (
                          <div>Min spend {formatZAR(row.min_subtotal_cents)}</div>
                        )}
                        {row.first_order_only && <div>First order only</div>}
                        {row.min_subtotal_cents === 0 && !row.first_order_only && (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="p-4 text-muted text-xs whitespace-nowrap">{validityLabel(row)}</td>
                      <td className="p-4 text-right text-white whitespace-nowrap">
                        {row.times_redeemed}
                        <span className="text-muted"> / {row.max_redemptions ?? '∞'}</span>
                      </td>
                      <td className="p-4 text-center">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium uppercase tracking-wide border ${status.cls}`}>
                          {status.label}
                        </span>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => openEdit(row)}
                            className="text-muted hover:text-gold transition-colors p-1"
                            aria-label={`Edit ${row.code}`}
                          >
                            <Edit2 size={16} />
                          </button>
                          <button
                            onClick={() => handleToggleActive(row)}
                            className={`transition-colors p-1 ${row.is_active ? 'text-green-400 hover:text-red-400' : 'text-muted hover:text-green-400'}`}
                            aria-label={row.is_active ? `Deactivate ${row.code}` : `Activate ${row.code}`}
                          >
                            {row.is_active ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-muted text-xs mt-4">
        Codes are deactivated, not deleted — placed orders record the code they used.
      </p>

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit ${editing.code}` : 'Add Discount Code'}
      >
        <DiscountForm discount={editing} onClose={() => setModalOpen(false)} />
      </Modal>
    </AdminLayout>
  )
}
