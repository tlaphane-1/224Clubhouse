import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Check, Search, AlertTriangle } from 'lucide-react'
import { useOrderTracking } from '../hooks/useOrderTracking'
import { formatZAR } from '../utils/formatCurrency'
import {
  STATUS_STEPS,
  statusLabel,
  paymentLabel,
} from '../utils/orderStatus'

export default function TrackOrder() {
  const [searchParams] = useSearchParams()

  const [orderNumber, setOrderNumber] = useState(searchParams.get('order') || '')
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    document.title = 'Track Your Order | 224 Clubhouse'
  }, [])

  const { data, isLoading, isError } = useOrderTracking(
    orderNumber.trim(),
    email.trim(),
    submitted,
  )

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!orderNumber.trim() || !email.trim()) return
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
            Enter your order number and the email you checked out with to see live status.
          </p>
        </div>

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
              We couldn't find an order with that number and email. Double-check both and try again.
            </p>
          </div>
        )}

        {/* Found */}
        {data && <OrderTracking order={data} />}
      </div>
    </div>
  )
}

function OrderTracking({ order }) {
  const {
    order_number,
    status,
    status_history = [],
    payment_method,
    subtotal,
    shipping_fee,
    total,
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
            {items.map((item) => (
              <div key={item.id} className="flex justify-between text-sm">
                <div>
                  <span className="text-white">{item.name}</span>
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
