import { useEffect } from 'react'
import { useLocation, Link } from 'react-router-dom'
import { CheckCircle, Package, Truck } from 'lucide-react'
import { formatZAR } from '../utils/formatCurrency'
import { paymentLabel } from '../utils/orderStatus'

export default function OrderConfirmation() {
  const { state } = useLocation()

  useEffect(() => {
    document.title = 'Order Confirmed | 224 Clubhouse'
  }, [])

  // No navigation state (e.g. the user refreshed the page). We can't query the
  // order by id — anon clients cannot read `orders` directly — so point them at
  // the live tracking page instead.
  if (!state?.order) {
    return (
      <div className="min-h-screen pt-28 pb-20 animate-fadeIn">
        <div className="max-w-2xl mx-auto px-4">
          <div className="bg-surface border border-border rounded-2xl p-8 text-center animate-scaleIn">
            <CheckCircle size={56} className="text-green-400 mx-auto mb-4" strokeWidth={1.5} />
            <h1 className="font-heading text-2xl font-bold text-white mb-3">Your order was placed!</h1>
            <p className="text-muted text-sm mb-8">
              Use Track Order with your order number and email to see live status.
            </p>
            <Link
              to="/track"
              className="btn-gold px-8 py-3 inline-flex items-center gap-2 text-sm uppercase tracking-widest"
            >
              Track Order
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const { order, items = [], customer = {}, paymentMethod } = state
  const firstName = (customer.name || '').split(' ')[0]

  return (
    <div className="min-h-screen pt-28 pb-20 animate-fadeIn">
      <div className="max-w-2xl mx-auto px-4">
        {/* Success Header */}
        <div className="text-center mb-10">
          <div className="inline-flex animate-scaleIn">
            <CheckCircle size={64} className="text-green-400" strokeWidth={1.5} />
          </div>
          <div className="animate-fadeIn">
            <h1 className="font-heading text-3xl font-bold text-white mt-4 mb-2">Order Confirmed!</h1>
            <p className="text-muted">
              {firstName ? `Thank you, ${firstName}. ` : 'Thank you. '}We've received your order.
            </p>
          </div>
        </div>

        {/* Order Card */}
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          {/* Order Number */}
          <div className="p-6 border-b border-border text-center">
            <p className="text-muted text-xs uppercase tracking-widest mb-1">Order Number</p>
            <p className="font-mono text-gold font-semibold text-lg">{order.order_number}</p>
          </div>

          {/* Items */}
          <div className="p-6 border-b border-border">
            <h3 className="text-white font-semibold text-sm uppercase tracking-widest mb-4">Items Ordered</h3>
            <div className="space-y-3">
              {items.map((item, i) => (
                <div key={item.id ?? i} className="flex justify-between text-sm">
                  <div>
                    <span className="text-white">{item.name}</span>
                    <span className="text-muted ml-2">× {item.quantity}</span>
                  </div>
                  <span className="text-white">{formatZAR(item.price * item.quantity)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Totals */}
          <div className="p-6 border-b border-border space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">Subtotal</span>
              <span className="text-white">{formatZAR(order.subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Shipping</span>
              <span className={order.shipping_fee === 0 ? 'text-green-400' : 'text-white'}>
                {order.shipping_fee === 0 ? 'FREE' : formatZAR(order.shipping_fee)}
              </span>
            </div>
            <div className="flex justify-between pt-3 border-t border-border">
              <span className="text-white font-semibold">Total</span>
              <span className="text-gold font-bold text-lg">{formatZAR(order.total)}</span>
            </div>
          </div>

          {/* Cash/Card on Delivery callout */}
          <div className="p-6 border-b border-border bg-gold/5 flex items-start gap-3">
            <Package size={20} className="text-gold flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-white text-sm font-medium">
                Pay {formatZAR(order.total)} by {paymentLabel(paymentMethod)} when your order is delivered.
              </p>
              <p className="text-muted text-xs mt-1">No payment needed now.</p>
            </div>
          </div>

          {/* Estimated delivery */}
          <div className="p-6 flex items-center gap-3">
            <Truck size={20} className="text-gold flex-shrink-0" />
            <div>
              <p className="text-white text-sm font-medium">Estimated Delivery</p>
              <p className="text-muted text-xs mt-0.5">
                2–5 business days{customer.city ? ` to ${customer.city}` : ''}
              </p>
            </div>
          </div>
        </div>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row gap-3 mt-8">
          <Link
            to={`/track?order=${order.order_number}`}
            className="btn-gold flex-1 py-3 inline-flex items-center justify-center gap-2 text-sm uppercase tracking-widest"
          >
            Track your order
          </Link>
          <Link
            to="/store"
            className="btn-outline flex-1 py-3 inline-flex items-center justify-center gap-2 text-sm uppercase tracking-widest"
          >
            Continue shopping
          </Link>
        </div>
      </div>
    </div>
  )
}
