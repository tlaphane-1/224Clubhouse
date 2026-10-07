import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Truck, Plus, AlertTriangle, Phone } from 'lucide-react'
import toast from 'react-hot-toast'
import AdminLayout from '../../components/admin/AdminLayout'
import Modal from '../../components/ui/Modal'
import { useDrivers, useCreateDriver, useSetDriverActive, useDriverLocations } from '../../hooks/useDelivery'

const LiveMap = lazy(() => import('../../components/delivery/LiveMap'))

const ago = (iso) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)} min ago`
}

function AddDriverForm({ onDone }) {
  const create = useCreateDriver()
  const [form, setForm] = useState({ fullName: '', phone: '', email: '', password: '' })
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    try {
      const res = await create.mutateAsync(form)
      toast.success(res?.linkedExisting
        ? 'That email already had an account — it is now a driver (their existing password still applies).'
        : 'Driver added. Share the email and password with them.')
      onDone()
    } catch (err) {
      toast.error(err.message || 'Could not add the driver')
    }
  }

  const field = 'block text-muted text-xs uppercase tracking-widest mb-1.5'
  return (
    <form id="add-driver" onSubmit={submit} className="space-y-4">
      <div>
        <label htmlFor="drv-name" className={field}>Full name *</label>
        <input id="drv-name" required className="input-base" value={form.fullName} onChange={set('fullName')} autoComplete="off" />
      </div>
      <div>
        <label htmlFor="drv-phone" className={field}>Phone</label>
        <input id="drv-phone" type="tel" className="input-base" value={form.phone} onChange={set('phone')} autoComplete="off" />
      </div>
      <div>
        <label htmlFor="drv-email" className={field}>Login email *</label>
        <input id="drv-email" type="email" required className="input-base" value={form.email} onChange={set('email')} autoComplete="off" />
      </div>
      <div>
        <label htmlFor="drv-password" className={field}>Password * (8+ characters)</label>
        <input id="drv-password" type="text" minLength={8} className="input-base" value={form.password} onChange={set('password')} autoComplete="new-password" />
        <p className="text-muted text-xs mt-1">They sign in at 224clubhouse.store/driver. Not needed if the email already has an account.</p>
      </div>
      <button type="submit" disabled={create.isPending} className="btn-gold w-full py-3">
        {create.isPending ? 'Adding…' : 'Add driver'}
      </button>
    </form>
  )
}

export default function Drivers() {
  const { data: drivers, isLoading, isError, refetch } = useDrivers()
  const { data: locations } = useDriverLocations()
  const setActive = useSetDriverActive()
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    document.title = 'Drivers | 224 Admin'
  }, [])

  const markers = useMemo(
    () => (locations ?? []).map(l => ({ id: l.driver_id, lat: l.lat, lng: l.lng, label: l.name })),
    [locations],
  )
  const liveById = new Map((locations ?? []).map(l => [l.driver_id, l]))

  const toggle = async (d) => {
    try {
      await setActive.mutateAsync({ userId: d.user_id, active: !d.active })
      toast.success(d.active ? `${d.full_name} can no longer use the driver portal` : `${d.full_name} re-enabled`)
    } catch (err) {
      toast.error(err.message || 'Could not update')
    }
  }

  return (
    <AdminLayout>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-8">
        <div>
          <h1 className="font-heading text-3xl font-bold text-white">Drivers</h1>
          <p className="text-muted text-sm mt-1">Drivers sign in at <span className="text-white">224clubhouse.store/driver</span>. Assign orders on the Orders page.</p>
        </div>
        <button type="button" onClick={() => setAdding(true)} className="btn-gold flex items-center gap-2 text-sm">
          <Plus size={16} /> Add driver
        </button>
      </div>

      <section className="bg-surface border border-border rounded-xl p-4 sm:p-6 mb-6">
        <h2 className="font-heading text-lg font-semibold text-white mb-1">On the road now</h2>
        <p className="text-muted text-xs mb-4">Drivers with an order out for delivery who shared a location in the last 15 minutes. Updates every 15 seconds.</p>
        {markers.length > 0 ? (
          <Suspense fallback={<div className="h-80 skeleton rounded-xl" />}>
            <LiveMap markers={markers} className="h-80" ariaLabel="Map of drivers currently on deliveries" />
          </Suspense>
        ) : (
          <p className="text-muted text-sm">No drivers on deliveries right now.</p>
        )}
      </section>

      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-12"><div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" /></div>
        ) : isError ? (
          <div className="p-10 text-center">
            <AlertTriangle size={28} className="text-red-400 mx-auto mb-3" />
            <p className="text-white text-sm mb-5">Couldn't load drivers.</p>
            <button onClick={() => refetch()} className="btn-gold text-sm">Retry</button>
          </div>
        ) : drivers.length === 0 ? (
          <div className="p-8 text-center">
            <Truck size={28} className="text-muted mx-auto mb-3" />
            <p className="text-white text-sm mb-1">No drivers yet</p>
            <p className="text-muted text-xs">Add one to start assigning deliveries.</p>
          </div>
        ) : (
          drivers.map(d => {
            const live = liveById.get(d.user_id)
            return (
              <div key={d.user_id} className="border-b border-border/50 last:border-0 px-4 sm:px-5 py-4 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className={`font-medium text-sm ${d.active ? 'text-white' : 'text-muted line-through'}`}>{d.full_name}</p>
                  {d.phone && (
                    <a href={`tel:${d.phone}`} className="inline-flex items-center gap-1 text-gold text-xs underline underline-offset-2 min-h-11">
                      <Phone size={12} /> {d.phone}
                    </a>
                  )}
                  {live && (
                    <p className="text-green-400 text-xs">On the road · {live.orders.join(', ') || '—'} · {ago(live.updated_at)}</p>
                  )}
                </div>
                <button type="button" onClick={() => toggle(d)} disabled={setActive.isPending}
                  className="focus-ring h-11 px-4 rounded-lg text-sm border border-border text-muted hover:text-white disabled:opacity-50">
                  {d.active ? 'Disable' : 'Enable'}
                </button>
              </div>
            )
          })
        )}
      </div>

      <Modal isOpen={adding} onClose={() => setAdding(false)} title="Add a driver" size="sm" sheet>
        <AddDriverForm onDone={() => setAdding(false)} />
      </Modal>
    </AdminLayout>
  )
}
