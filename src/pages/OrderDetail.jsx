import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Check, AlertTriangle, Package, RotateCcw } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../context/AuthContext'
import { useCart } from '../context/CartContext'
import { useMyOrder } from '../hooks/useMyOrders'
import { fetchProductsByIds } from '../hooks/useProducts'
import { formatZAR } from '../utils/formatCurrency'
import { STATUS_STEPS, statusLabel, paymentLabel } from '../utils/orderStatus'

// Customer-facing detail view for one of their own orders (/orders/:id).
// Owner RLS + the explicit user_id filter in useMyOrder mean a signed-in user
// can only ever load their own order here — anything else resolves to null.
export default function OrderDetail() {
  const { id } = useParams()
  const { user, loading: authLoading } = useAuth()
  const { data: order, isLoading, isError } = useMyOrder(id)

  useEffect(() => {
    document.title = 'Order Details | 224 Clubhouse'
  }, [])

  if (authLoading || (user && isLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen pt-28 pb-20 animate-fadeIn">
      <div className="max-w-2xl mx-auto px-4">
        <div className="mb-10">
          <Link
            to="/orders"
            className="text-muted hover:text-gold text-xs uppercase tracking-widest inline-flex items-center gap-2 mb-4 transition-colors"
          >
            <ArrowLeft size={14} />
            Back to My Orders
          </Link>
          <p className="text-gold text-xs uppercase tracking-[0.3em] mb-3">Your Account</p>
          <h1 className="font-heading text-3xl md:text-4xl font-bold text-white">Order Details</h1>
        </div>

        {/* Signed out, or the order isn't theirs / doesn't exist */}
        {!user && <NotYours signedOut />}
        {user && isError && (
          <div className="bg-surface border border-red-500/20 rounded-2xl p-6 text-center">
            <AlertTriangle size={28} className="text-red-400 mx-auto mb-3" />
            <p className="text-white text-sm">
              Something went wrong loading this order. Please try again in a moment.
            </p>
          </div>
        )}
        {user && !isLoading && !isError && !order && <NotYours />}

        {user && order && <OrderDetailBody order={order} />}
      </div>
    </div>
  )
}

function NotYours({ signedOut = false }) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-8 text-center">
      <Package size={28} className="text-muted mx-auto mb-3" />
      <p className="text-white text-sm mb-1">
        {signedOut ? 'Sign in to see this order' : "We couldn't find that order"}
      </p>
      <p className="text-muted text-xs mb-6">
        {signedOut
          ? 'Order details are only visible on the account that placed them.'
          : "It may have been placed on a different account, or the link is out of date."}
      </p>
      <Link to="/orders" className="btn-gold px-6 py-3 text-xs uppercase tracking-widest">
        Go to My Orders
      </Link>
    </div>
  )
}

function OrderDetailBody({ order }) {
  const {
    order_number,
    status,
    status_history = [],
    payment_method,
    created_at,
    subtotal,
    shipping_fee,
    total,
    items = [],
    shipping_address: addr = {},
  } = order

  const { addItem } = useCart()
  const navigate = useNavigate()
  const [reordering, setReordering] = useState(false)

  // Map status -> timestamp for quick lookup when rendering the timeline.
  const reachedAt = {}
  for (const entry of status_history) {
    if (entry?.status) reachedAt[entry.status] = entry.at
  }

  const cancelled = status === 'cancelled'
  const currentIndex = STATUS_STEPS.indexOf(status)

  // Re-add this order's items using TODAY'S product rows: current stock caps
  // the quantity, unavailable/deleted products are skipped, and current prices
  // apply (the item snapshot's price is history, not an offer).
  const handleReorder = async () => {
    if (reordering) return
    setReordering(true)
    try {
      const products = await fetchProductsByIds(items.map((i) => i.id).filter(Boolean))
      const byId = new Map(products.map((p) => [p.id, p]))

      const skipped = []
      const priceChanged = []
      let added = 0
      for (const item of items) {
        const product = byId.get(item.id)
        if (!product || !product.is_available || product.stock_quantity < 1) {
          skipped.push(item.name)
          continue
        }
        addItem(product, Math.min(item.quantity, product.stock_quantity))
        added += 1
        if (product.price !== item.price) priceChanged.push(product.name)
      }

      if (added === 0) {
        toast.error('None of these items are available right now.')
        setReordering(false)
        return
      }
      toast.success(`${added} item${added === 1 ? '' : 's'} added to your cart`)
      if (skipped.length > 0) {
        toast(`No longer available: ${skipped.join(', ')}`, { icon: '⚠️' })
      }
      if (priceChanged.length > 0) {
        toast(`Prices have changed for: ${priceChanged.join(', ')}`, { icon: 'ℹ️' })
      }
      navigate('/cart')
    } catch {
      toast.error('Could not add these items right now. Please try again.')
      setReordering(false)
    }
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="bg-surface border border-border rounded-2xl p-6 flex items-center justify-between flex-wrap gap-4">
        <div>
          <p className="text-muted text-xs uppercase tracking-widest mb-1">Order Number</p>
          <p className="font-mono text-gold font-semibold">{order_number}</p>
          <p className="text-muted text-xs mt-2">
            Placed {new Date(created_at).toLocaleString('en-ZA')}
            {' · '}{paymentLabel(payment_method)}
          </p>
        </div>
        <button
          type="button"
          onClick={handleReorder}
          disabled={reordering}
          className="btn-outline px-5 py-2.5 text-xs uppercase tracking-widest inline-flex items-center gap-2 disabled:opacity-50"
        >
          <RotateCcw size={14} />
          {reordering ? 'Adding…' : 'Reorder'}
        </button>
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

      {/* Timeline — same presentation as /track */}
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
                  {!isLast && (
                    <span
                      className={`absolute left-[11px] top-6 bottom-0 w-px ${
                        i < currentIndex ? 'bg-gold' : 'bg-border'
                      }`}
                    />
                  )}
                  <span
                    className={`relative z-10 flex items-center justify-center w-6 h-6 rounded-full flex-shrink-0 border ${
                      reached
                        ? 'bg-gold border-gold text-black'
                        : 'bg-surface border-border text-transparent'
                    }`}
                  >
                    {reached && <Check size={14} strokeWidth={3} />}
                  </span>
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

      {/* Delivery address */}
      <div className="bg-surface border border-border rounded-2xl p-6">
        <h3 className="text-white font-semibold text-sm uppercase tracking-widest mb-4">Delivery Address</h3>
        <p className="text-white text-sm leading-relaxed">
          {addr?.street}
          {addr?.apartment && <><br />{addr.apartment}</>}
          {(addr?.city || addr?.province) && (
            <><br />{[addr?.city, addr?.province].filter(Boolean).join(', ')}</>
          )}
          {addr?.postalCode && <><br />{addr.postalCode}</>}
        </p>
      </div>

      {/* Amount due callout */}
      {!cancelled && (
        <div className="bg-gold/5 border border-gold/20 rounded-2xl p-6">
          <p className="text-gold text-xs uppercase tracking-widest mb-1">Amount due on delivery</p>
          <p className="text-white text-lg font-semibold">
            {formatZAR(total)} <span className="text-muted text-sm font-normal">— {paymentLabel(payment_method)}</span>
          </p>
        </div>
      )}
    </div>
  )
}
