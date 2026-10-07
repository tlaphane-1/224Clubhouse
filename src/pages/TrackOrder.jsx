import { lineName } from '../utils/variants'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Check, Search, AlertTriangle, X } from 'lucide-react'
import { useAuth } from '../context/useAuth'
import { useOrderTracking } from '../hooks/useOrderTracking'
import { formatZAR } from '../utils/formatCurrency'
import { forgetOrder, getRecentOrders } from '../utils/recentOrders'
import {
  STATUS_STEPS,
  statusLabel,
  paymentLabel,
  eftAwaitingPayment,
} from '../utils/orderStatus'
import EftDetails from '../components/checkout/EftDetails'
import DeliveryTracker from '../components/delivery/DeliveryTracker'

export default function TrackOrder() {
  const [searchParams] = useSearchParams()
  const { user } = useAuth()

  const [orderNumber, setOrderNumber] = useState(searchParams.get('order') || '')
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [recent, setRecent] = useState(() => getRecentOrders())

  useEffect(() => {
    document.title = 'Track Your Order | 224 Clubhouse'
  }, [])

  // Orders placed on this device track themselves — one tap, no order number needed.
  const track = (order) => {
    setOrderNumber(order.orderNumber)
    setEmail(order.email)
    setSubmitted(true)
  }

  // Arriving from the confirmation page, /orders, or a link with ?order= — if we
  // know the matching email (remembered on this device, or the signed-in
  // account, whose email is what place_cod_order stamps on the order), look it
  // up without asking again. `user` is in the deps because auth resolves async;
  // the `submitted` guard stops re-runs once a lookup has started.
  useEffect(() => {
    const fromUrl = searchParams.get('order')
    if (!fromUrl || submitted) return
    const num = fromUrl.trim().toUpperCase()
    const known = getRecentOrders().find((o) => o.orderNumber === num)
    if (known) track(known)
    else if (user?.email) track({ orderNumber: num, email: user.email })
    // Only reacts to the incoming URL and auth state, not to later typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, user])

  // Signed-in customers shouldn't have to retype their email; keep the field
  // editable for looking up older, pre-account orders under another address.
  useEffect(() => {
    if (user?.email) setEmail((cur) => cur || user.email)
  }, [user])

  const dropRecent = (num) => {
    forgetOrder(num)
    setRecent(getRecentOrders())
  }

  const { data, isLoading, isError } = useOrderTracking(
    orderNumber.trim(),
    email.trim(),
    submitted,
  )

  // Both the order number AND the email are required. The email-only listing
  // (get_orders_by_email) was retired on 2026-10-07: anyone who could guess an
  // address could list that customer's orders. Signed-in customers see all
  // their orders on /orders instead.
  const handleSubmit = (e) => {
    e.preventDefault()
    if (!email.trim() || !orderNumber.trim()) return
    setSubmitted(true)
  }

  // The query is "done" with a null result only after a real fetch returned no row.
  const notFound = submitted && !isLoading && !isError && data === null

  return (
    <div className="min-h-screen pt-28 pb-20 animate-fadeIn">
      <div className="max-w-2xl mx-auto px-4">
        {/* Heading */}
        <div className="mb-10">
          <p className="text-gold text-xs uppercase tracking-[0.3em] mb-3">Order Status</p>
          <h1 className="font-heading text-3xl md:text-4xl font-bold text-white">Track Your Order</h1>
          <p className="text-muted text-sm mt-3">
            Enter your order number and the email you checked out with.{' '}
            <Link to="/orders" className="text-gold underline underline-offset-2">Signed in? See all your orders.</Link>
          </p>
        </div>

        {/* Orders placed from this browser — the common case is someone who just
            checked out and never wrote the number down. */}
        {recent.length > 0 && (
          <div className="bg-surface border border-border rounded-2xl p-6 mb-8">
            <h2 className="text-white font-semibold text-sm uppercase tracking-widest mb-1">
              Your orders
            </h2>
            <p className="text-muted text-xs mb-4">Placed from this device.</p>
            <ul className="space-y-2">
              {recent.map((o) => (
                <li
                  key={o.orderNumber}
                  className="flex items-center justify-between gap-3 flex-wrap border border-border rounded-xl p-3"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-gold text-sm font-semibold">{o.orderNumber}</p>
                    <p className="text-muted text-xs mt-0.5">
                      {new Date(o.placedAt).toLocaleDateString('en-ZA')}
                      {o.total != null && ` · ${formatZAR(o.total)}`}
                      {o.itemCount ? ` · ${o.itemCount} item${o.itemCount === 1 ? '' : 's'}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => track(o)}
                      className="btn-gold px-4 py-2 text-xs uppercase tracking-widest"
                    >
                      Track
                    </button>
                    <button
                      type="button"
                      onClick={() => dropRecent(o.orderNumber)}
                      aria-label={`Remove ${o.orderNumber} from this device`}
                      className="text-muted hover:text-white p-2"
                    >
                      <X size={16} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Lookup form */}
        <form
          onSubmit={handleSubmit}
          className="bg-surface border border-border rounded-2xl p-6 space-y-4 mb-8"
        >
          <div>
            <label htmlFor="order-number" className="block text-muted text-xs uppercase tracking-widest mb-2">
              Order Number
            </label>
            <input
              id="order-number"
              type="text"
              className="input-base"
              placeholder="224-XXXXXX"
              required
              autoCapitalize="characters"
              value={orderNumber}
              onChange={(e) => setOrderNumber(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="order-email" className="block text-muted text-xs uppercase tracking-widest mb-2">
              Email
            </label>
            <input
              id="order-email"
              type="email"
              className="input-base"
              placeholder="you@example.com"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <button
            type="submit"
            className="btn-gold w-full py-3 inline-flex items-center justify-center gap-2 text-sm uppercase tracking-widest"
          >
            <Search size={16} />
            Track Order
          </button>
        </form>

        {/* Loading */}
        {submitted && isLoading && (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* Error */}
        {submitted && isError && (
          <div className="bg-surface border border-red-500/20 rounded-2xl p-6 text-center animate-fadeIn">
            <AlertTriangle size={28} className="text-red-400 mx-auto mb-3" />
            <p className="text-white text-sm">
              Something went wrong looking up your order. Please try again in a moment.
            </p>
          </div>
        )}

        {/* Not found */}
        {notFound && (
          <div className="bg-surface border border-border rounded-2xl p-6 text-center animate-fadeIn">
            <Search size={28} className="text-muted mx-auto mb-3" />
            <p className="text-white text-sm">
              We couldn't find any orders for those details. Double-check the order number and email and try again.
            </p>
          </div>
        )}

        {/* Found */}
        {data && <OrderTracking order={data} email={email.trim()} />}
      </div>
    </div>
  )
}

function OrderTracking({ order, email }) {
  const {
    order_number,
    status,
    status_history = [],
    payment_method,
    subtotal,
    shipping_fee,
    total,
    // get_order_tracking builds its own jsonb, so these two arrive only once the
    // RPC has been re-created to include them. Until that migration is applied
    // they're simply absent and the discount row is omitted — never a crash, and
    // never a wrong number: pre-discount orders have discount_cents = 0 anyway.
    discount_cents = 0,
    discount_code = null,
    items = [],
  } = order

  // Map status -> timestamp for quick lookup when rendering the timeline.
  const reachedAt = {}
  for (const entry of status_history) {
    if (entry?.status) reachedAt[entry.status] = entry.at
  }

  const cancelled = status === 'cancelled'
  const currentIndex = STATUS_STEPS.indexOf(status)

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="bg-surface border border-border rounded-2xl p-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-muted text-xs uppercase tracking-widest mb-1">Order Number</p>
          <p className="font-mono text-gold font-semibold">{order_number}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="relative flex w-2.5 h-2.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75 animate-ping" />
            <span className="relative inline-flex rounded-full w-2.5 h-2.5 bg-green-400" />
          </span>
          <span className="text-green-400 text-xs uppercase tracking-widest">Live tracking</span>
        </div>
      </div>

      {/* Live driver map while out for delivery (same order number + email). */}
      <DeliveryTracker orderNumber={order_number} email={email} status={status} />

      {/* EFT still to pay: the bank details must be reachable from here, not
          only from the one-off confirmation page. */}
      {eftAwaitingPayment(order) && (
        <EftDetails reference="your name and surname" amountLabel={formatZAR(total)} />
      )}

      {/* Cancelled banner */}
      {cancelled && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-6 flex items-start gap-3">
          <AlertTriangle size={20} className="text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-red-400 font-semibold text-sm">Order Cancelled</p>
            <p className="text-muted text-xs mt-1">
              This order has been cancelled. If you have questions, please contact us.
            </p>
          </div>
        </div>
      )}

      {/* Timeline */}
      {!cancelled && (
        <div className="bg-surface border border-border rounded-2xl p-6">
          <h3 className="text-white font-semibold text-sm uppercase tracking-widest mb-6">Progress</h3>
          <ol className="relative">
            {STATUS_STEPS.map((step, i) => {
              const reached = i <= currentIndex
              const isCurrent = i === currentIndex
              const at = reachedAt[step]
              const isLast = i === STATUS_STEPS.length - 1
              return (
                <li key={step} className="relative flex gap-4 pb-8 last:pb-0">
                  {/* Connector line */}
                  {!isLast && (
                    <span
                      className={`absolute left-[11px] top-6 bottom-0 w-px ${
                        i < currentIndex ? 'bg-gold' : 'bg-border'
                      }`}
                    />
                  )}
                  {/* Dot */}
                  <span
                    className={`relative z-10 flex items-center justify-center w-6 h-6 rounded-full flex-shrink-0 border ${
                      reached
                        ? 'bg-gold border-gold text-black'
                        : 'bg-surface border-border text-transparent'
                    }`}
                  >
                    {reached && <Check size={14} strokeWidth={3} />}
                  </span>
                  {/* Label */}
                  <div className="pt-0.5">
                    <p
                      className={`text-sm font-medium ${
                        isCurrent ? 'text-gold' : reached ? 'text-white' : 'text-muted'
                      }`}
                    >
                      {statusLabel(step)}
                    </p>
                    {at && (
                      <p className="text-muted text-xs mt-0.5">
                        {new Date(at).toLocaleString('en-ZA')}
                      </p>
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
        </div>
      )}

      {/* Order summary */}
      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        <div className="p-6 border-b border-border">
          <h3 className="text-white font-semibold text-sm uppercase tracking-widest mb-4">Order Summary</h3>
          <div className="space-y-3">
            {items.map((item, i) => (
              <div key={`${item.id}-${item.variant_id ?? ''}-${i}`} className="flex justify-between text-sm">
                <div>
                  <span className="text-white">{lineName(item)}</span>
                  <span className="text-muted ml-2">× {item.quantity}</span>
                </div>
                <span className="text-white">{formatZAR(item.price * item.quantity)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="p-6 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted">Subtotal</span>
            <span className="text-white">{formatZAR(subtotal)}</span>
          </div>
          {discount_cents > 0 && (
            <div className="flex justify-between">
              <span className="text-muted">
                Discount
                {discount_code ? <span className="text-gold"> ({discount_code})</span> : null}
              </span>
              <span className="text-gold font-medium">−{formatZAR(discount_cents)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted">Shipping</span>
            <span className={shipping_fee === 0 ? 'text-green-400' : 'text-white'}>
              {shipping_fee === 0 ? 'FREE' : formatZAR(shipping_fee)}
            </span>
          </div>
          <div className="flex justify-between pt-3 border-t border-border">
            <span className="text-white font-semibold">Total</span>
            <span className="text-gold font-bold text-lg">{formatZAR(total)}</span>
          </div>
        </div>
      </div>

      {/* Amount due callout */}
      <div className="bg-gold/5 border border-gold/20 rounded-2xl p-6">
        <p className="text-gold text-xs uppercase tracking-widest mb-1">Amount due on delivery</p>
        <p className="text-white text-lg font-semibold">
          {formatZAR(total)} <span className="text-muted text-sm font-normal">— {paymentLabel(payment_method)}</span>
        </p>
      </div>
    </div>
  )
}
