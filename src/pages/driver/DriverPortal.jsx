import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Phone, Navigation, MapPin, Truck, CheckCircle, AlertTriangle, LogOut, Radio } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../../context/useAuth'
import { useDriverOrders, useStartDelivery, useCompleteDelivery, useLocationSharing } from '../../hooks/useDelivery'
import { formatZAR } from '../../utils/formatCurrency'
import { paymentLabel, statusLabel } from '../../utils/orderStatus'
import { lineName } from '../../utils/variants'
import BrandLogo from '../../components/ui/BrandLogo'
import Badge from '../../components/ui/Badge'
import InstallDriverApp from '../../components/delivery/InstallDriverApp'

// /driver — the driver's phone is the target device. Big tap targets, one job
// per screen: see your deliveries, call, navigate, start, deliver.

function addressText(a = {}) {
  return [a.street, a.apartment, a.city, a.province, a.postalCode].filter(Boolean).join(', ')
}

function DriverSignIn() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const res = await signIn(email.trim(), password)
      if (!res.isDriver) toast.error('This account is not set up as a driver. Ask the club to add you.')
    } catch (err) {
      toast.error(err.message || 'Could not sign in')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="bg-surface border border-border rounded-2xl p-6 space-y-4">
      <h1 className="font-heading text-2xl font-bold text-white">Driver sign in</h1>
      <div>
        <label htmlFor="driver-email" className="block text-muted text-xs uppercase tracking-widest mb-1.5">Email</label>
        <input id="driver-email" type="email" autoComplete="username" required value={email}
          onChange={e => setEmail(e.target.value)} className="input-base" />
      </div>
      <div>
        <label htmlFor="driver-password" className="block text-muted text-xs uppercase tracking-widest mb-1.5">Password</label>
        <input id="driver-password" type="password" autoComplete="current-password" required value={password}
          onChange={e => setPassword(e.target.value)} className="input-base" />
      </div>
      <button type="submit" disabled={busy} className="btn-gold w-full py-3">{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  )
}

const SHARING_COPY = {
  starting: { tone: 'border-yellow-500/20 bg-yellow-500/10 text-yellow-400', text: 'Starting location sharing… allow location access if your phone asks.' },
  sharing: { tone: 'border-green-500/20 bg-green-500/10 text-green-400', text: 'Sharing your location with the customer. Keep this page open while you drive.' },
  denied: { tone: 'border-red-500/20 bg-red-500/10 text-red-400', text: "Location is blocked. Allow location for this site in your phone's browser settings, then reload." },
  unsupported: { tone: 'border-red-500/20 bg-red-500/10 text-red-400', text: "This browser can't share location. Use Chrome or Safari." },
  error: { tone: 'border-yellow-500/20 bg-yellow-500/10 text-yellow-400', text: 'Having trouble sending your location — check your signal. It will keep trying.' },
}

function OrderCard({ order }) {
  const start = useStartDelivery()
  const complete = useCompleteDelivery()
  const out = order.status === 'out_for_delivery'
  const done = order.status === 'delivered'
  const address = addressText(order.shipping_address)
  const eftUnpaid = order.payment_method === 'eft' && !order.paid_at

  const collect = order.payment_method === 'eft'
    ? (order.paid_at ? 'Paid by EFT — collect nothing' : 'EFT not paid yet — wait for the club to confirm')
    : `Collect ${formatZAR(order.total)} · ${paymentLabel(order.payment_method)}`

  const onStart = async () => {
    try {
      await start.mutateAsync(order.id)
      toast.success('Delivery started — the customer can now see you on the map')
    } catch (err) {
      toast.error(err.message || 'Could not start this delivery')
    }
  }
  const onComplete = async () => {
    if (!window.confirm(`Mark ${order.order_number} as delivered to ${order.customer_name}?`)) return
    try {
      await complete.mutateAsync(order.id)
      toast.success('Delivered ✔')
    } catch (err) {
      toast.error(err.message || 'Could not mark as delivered')
    }
  }

  return (
    <article className={`bg-surface border rounded-2xl p-4 ${out ? 'border-gold' : 'border-border'} ${done ? 'opacity-60' : ''}`}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="font-mono text-gold font-semibold">{order.order_number}</p>
        <Badge variant={order.status}>{statusLabel(order.status)}</Badge>
      </div>

      <p className="text-white font-semibold">{order.customer_name}</p>
      <p className="flex items-start gap-2 text-muted text-sm mt-1"><MapPin size={16} className="flex-shrink-0 mt-0.5" />{address || 'No address'}</p>

      <ul className="text-sm text-muted mt-3 space-y-0.5">
        {(order.items ?? []).map((it, i) => <li key={i}>{it.quantity}× {lineName(it)}</li>)}
      </ul>

      <p className={`mt-3 text-sm font-semibold ${eftUnpaid ? 'text-yellow-400' : 'text-white'}`}>{collect}</p>

      {!done && (
        <div className="grid grid-cols-2 gap-2 mt-4">
          <a href={`tel:${order.customer_phone}`} className="btn-outline h-12 inline-flex items-center justify-center gap-2 text-sm">
            <Phone size={16} /> Call
          </a>
          <a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`}
            target="_blank" rel="noopener noreferrer"
            className="btn-outline h-12 inline-flex items-center justify-center gap-2 text-sm">
            <Navigation size={16} /> Navigate
          </a>
          {out ? (
            <button type="button" onClick={onComplete} disabled={complete.isPending}
              className="btn-gold col-span-2 h-14 inline-flex items-center justify-center gap-2 text-base">
              <CheckCircle size={20} /> {complete.isPending ? 'Saving…' : 'Delivered'}
            </button>
          ) : (
            <button type="button" onClick={onStart} disabled={start.isPending || eftUnpaid}
              className="btn-gold col-span-2 h-14 inline-flex items-center justify-center gap-2 text-base">
              <Truck size={20} /> {start.isPending ? 'Starting…' : 'Start delivery'}
            </button>
          )}
        </div>
      )}
    </article>
  )
}

export default function DriverPortal() {
  const { user, loading, isDriver, signOut } = useAuth()
  const { data: orders, isLoading, isError, refetch } = useDriverOrders()

  useEffect(() => {
    document.title = 'Driver | 224 Clubhouse'
  }, [])

  const enRoute = (orders ?? []).some(o => o.status === 'out_for_delivery')
  const sharing = useLocationSharing(Boolean(user && isDriver && enRoute))
  const active = (orders ?? []).filter(o => o.status !== 'delivered')
  const doneToday = (orders ?? []).filter(o => o.status === 'delivered')

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 bg-background/95 backdrop-blur-md border-b border-border">
        <div className="max-w-xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/driver" className="flex items-center gap-3"><BrandLogo className="h-7" /><span className="text-muted text-xs uppercase tracking-[0.3em]">Driver</span></Link>
          {user && (
            <button type="button" onClick={signOut} aria-label="Sign out"
              className="focus-ring rounded-lg w-11 h-11 flex items-center justify-center text-muted hover:text-white">
              <LogOut size={18} />
            </button>
          )}
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 py-6 space-y-4">
        <InstallDriverApp />
        {loading ? (
          <div className="flex justify-center py-12"><div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" /></div>
        ) : !user ? (
          <DriverSignIn />
        ) : !isDriver ? (
          <div className="bg-surface border border-border rounded-2xl p-6 text-center">
            <AlertTriangle size={28} className="text-gold mx-auto mb-3" />
            <p className="text-white text-sm mb-1">This account isn't set up as a driver.</p>
            <p className="text-muted text-xs">Ask the club to add you, then sign in again.</p>
          </div>
        ) : (
          <>
            {enRoute && SHARING_COPY[sharing.state] && (
              <div role="status" className={`border rounded-xl p-3 flex items-start gap-2 text-sm ${SHARING_COPY[sharing.state].tone}`}>
                <Radio size={16} className="flex-shrink-0 mt-0.5" />
                <span>{SHARING_COPY[sharing.state].text}</span>
              </div>
            )}

            <h1 className="font-heading text-2xl font-bold text-white">Your deliveries</h1>

            {isLoading ? (
              [0, 1].map(i => <div key={i} className="h-48 skeleton rounded-2xl" />)
            ) : isError ? (
              <div className="bg-surface border border-red-500/20 rounded-2xl p-6 text-center">
                <AlertTriangle size={28} className="text-red-400 mx-auto mb-3" />
                <p className="text-white text-sm mb-4">Couldn't load your deliveries.</p>
                <button type="button" onClick={() => refetch()} className="btn-gold text-sm">Retry</button>
              </div>
            ) : active.length === 0 ? (
              <div className="bg-surface border border-border rounded-2xl p-8 text-center">
                <Truck size={28} className="text-muted mx-auto mb-3" />
                <p className="text-white text-sm mb-1">No deliveries assigned</p>
                <p className="text-muted text-xs">New ones appear here automatically.</p>
              </div>
            ) : (
              active.map(o => <OrderCard key={o.id} order={o} />)
            )}

            {doneToday.length > 0 && (
              <section className="pt-4">
                <h2 className="text-muted text-xs uppercase tracking-widest mb-2">Delivered today ({doneToday.length})</h2>
                <div className="space-y-2">{doneToday.map(o => <OrderCard key={o.id} order={o} />)}</div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  )
}
