import { useEffect, useState } from 'react'
import { UserCheck, Plus, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import AdminLayout from '../../components/admin/AdminLayout'
import Modal from '../../components/ui/Modal'
import { useStaffMembers, useAddStaff, useSetStaffActive } from '../../hooks/useStaff'
import { tenant, adminTitle } from '../../tenant'

// Admin → Staff: the accounts that can use the counter tablet and clock in.
// A staff member is an existing account of this store (they sign up on the
// site first); the counter never needs an admin login.

function AddStaffForm({ onDone }) {
  const add = useAddStaff()
  const [form, setForm] = useState({ email: '', fullName: '' })
  const [error, setError] = useState('')
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    try {
      await add.mutateAsync({ email: form.email.trim(), fullName: form.fullName.trim() })
      toast.success(`${form.fullName.trim()} can now use the counter.`)
      onDone()
    } catch (err) {
      setError(err.message || 'Could not add staff')
    }
  }

  const label = 'block text-muted text-xs uppercase tracking-widest mb-1.5'
  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label htmlFor="staff-name" className={label}>Name *</label>
        <input id="staff-name" className="input-base text-sm" value={form.fullName} onChange={set('fullName')} required maxLength={80} autoComplete="off" />
      </div>
      <div>
        <label htmlFor="staff-email" className={label}>Account email *</label>
        <input id="staff-email" type="email" className="input-base text-sm" value={form.email} onChange={set('email')} required autoComplete="off" />
        <p className="text-muted text-xs mt-1">They must already have an account on {tenant.domain.apex}.</p>
      </div>
      {error && <p className="text-red-400 text-sm" role="alert">{error}</p>}
      <button type="submit" disabled={add.isPending} className="btn-gold w-full min-h-11">
        {add.isPending ? 'Adding…' : 'Add staff'}
      </button>
    </form>
  )
}

export default function AdminStaff() {
  const { data: staff = [], isLoading, isError, refetch } = useStaffMembers()
  const setActive = useSetStaffActive()
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    document.title = adminTitle('Staff')
  }, [])

  const toggle = async (s) => {
    try {
      await setActive.mutateAsync({ userId: s.user_id, active: !s.active })
      toast.success(s.active ? `${s.full_name} can no longer use the counter` : `${s.full_name} can use the counter again`)
    } catch (err) {
      toast.error(err.message || 'Could not update staff')
    }
  }

  return (
    <AdminLayout>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-8">
        <div>
          <h1 className="font-heading text-3xl font-bold text-white">Staff</h1>
          <p className="text-muted text-sm mt-1">Staff sign in on the counter tablet at <span className="text-white">{tenant.domain.apex}/counter</span>.</p>
        </div>
        <button type="button" onClick={() => setAdding(true)} className="btn-gold flex items-center gap-2 text-sm">
          <Plus size={16} /> Add staff
        </button>
      </div>

      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-12"><div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" /></div>
        ) : isError ? (
          <div className="p-10 text-center">
            <AlertTriangle size={28} className="text-red-400 mx-auto mb-3" />
            <p className="text-white text-sm mb-5">Couldn&apos;t load staff.</p>
            <button type="button" onClick={() => refetch()} className="btn-gold text-sm">Retry</button>
          </div>
        ) : staff.length === 0 ? (
          <div className="p-8 text-center">
            <UserCheck size={28} className="text-muted mx-auto mb-3" />
            <p className="text-white text-sm mb-1">No staff yet</p>
            <p className="text-muted text-xs">Add the cashier&apos;s account email.</p>
          </div>
        ) : (
          staff.map(s => (
            <div key={s.user_id} className="border-b border-border/50 last:border-0 px-4 sm:px-5 py-4 flex flex-wrap items-center justify-between gap-3">
              <p className={`font-medium text-sm ${s.active ? 'text-white' : 'text-muted line-through'}`}>{s.full_name}</p>
              <button type="button" onClick={() => toggle(s)} disabled={setActive.isPending}
                className="focus-ring h-11 px-4 rounded-lg text-sm border border-border text-muted hover:text-white disabled:opacity-50">
                {s.active ? 'Disable' : 'Enable'}
              </button>
            </div>
          ))
        )}
      </div>

      <Modal isOpen={adding} onClose={() => setAdding(false)} title="Add staff" size="sm" sheet>
        <AddStaffForm onDone={() => setAdding(false)} />
      </Modal>
    </AdminLayout>
  )
}
