import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Trash2, ShoppingBag, ArrowRight } from 'lucide-react'
import { useCart } from '../context/CartContext'
import { formatZAR } from '../utils/formatCurrency'
import { SHIPPING_FEE, SHIPPING_THRESHOLD } from '../components/checkout/OrderSummary'
import WhatsAppOrderPanel from '../components/store/WhatsAppOrderPanel'

export default function Cart() {
  const { items, removeItem, updateQuantity, cartSubtotal } = useCart()
  const shippingFee = cartSubtotal >= SHIPPING_THRESHOLD ? 0 : SHIPPING_FEE
  const total = cartSubtotal + shippingFee

  useEffect(() => {
    document.title = 'Cart | 224 Clubhouse'
  }, [])

  if (items.length === 0) {
    return (
      <div className="min-h-screen pt-28 flex flex-col items-center justify-center px-4">
        <div
          className="text-center animate-fadeIn"
        >
          <ShoppingBag size={56} className="text-muted mx-auto mb-6" strokeWidth={1} />
          <h2 className="font-heading text-2xl font-semibold text-white mb-3">Your cart is empty</h2>
          <p className="text-muted mb-8">Add something from the store to get started.</p>
          <Link to="/store" className="btn-gold px-8 py-3 flex items-center gap-2 inline-flex">
            Continue Shopping <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div
      className="min-h-screen pt-28 pb-20 animate-fadeIn"
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-10">
          <p className="text-gold text-xs uppercase tracking-[0.4em] mb-2">Review</p>
          <h1 className="font-heading text-4xl font-bold text-white">Your Cart</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Items */}
          <div className="lg:col-span-2 space-y-4">
            {items.map(item => (
              <div key={item.id} className="flex gap-4 p-4 bg-surface border border-border rounded-xl">
                {/* Image */}
                <Link to={`/store/${item.slug}`} className="flex-shrink-0">
                  <div className="w-20 h-20 rounded-lg bg-background overflow-hidden">
                    {item.images?.[0] ? (
                      <img src={item.images[0]} alt={item.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <span className="font-heading text-gold/30 font-bold text-sm">224</span>
                      </div>
                    )}
                  </div>
                </Link>

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <Link to={`/store/${item.slug}`} className="text-white font-semibold hover:text-gold transition-colors block truncate">
                    {item.name}
                  </Link>
                  <p className="text-gold font-bold mt-1">{formatZAR(item.price)}</p>

                  <div className="flex items-center gap-3 mt-3">
                    <div className="flex items-center gap-2 border border-border rounded-lg p-1">
                      <button
                        onClick={() => updateQuantity(item.id, item.quantity - 1)}
                        className="w-7 h-7 flex items-center justify-center text-muted hover:text-white transition-colors text-sm"
                      >
                        −
                      </button>
                      <span className="text-white text-sm w-6 text-center">{item.quantity}</span>
                      <button
                        onClick={() => updateQuantity(item.id, item.quantity + 1)}
                        className="w-7 h-7 flex items-center justify-center text-muted hover:text-white transition-colors text-sm"
                      >
                        +
                      </button>
                    </div>
                    <span className="text-muted text-xs ml-auto">{formatZAR(item.price * item.quantity)}</span>
                  </div>
                </div>

                {/* Remove */}
                <button
                  onClick={() => removeItem(item.id)}
                  className="text-muted hover:text-red-400 transition-colors self-start mt-1 flex-shrink-0"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            ))}

            <Link to="/store" className="flex items-center gap-2 text-muted hover:text-gold text-sm transition-colors mt-4">
              ← Continue Shopping
            </Link>
          </div>

          {/* Order Summary */}
          <div>
            <div className="sticky top-28 space-y-6">
            <div className="bg-surface border border-border rounded-xl p-6">
              <h3 className="font-heading text-lg font-semibold text-white mb-5">Order Summary</h3>

              <div className="space-y-3 mb-5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted">Subtotal ({items.reduce((s, i) => s + i.quantity, 0)} items)</span>
                  <span className="text-white">{formatZAR(cartSubtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Shipping</span>
                  <span className={shippingFee === 0 ? 'text-green-400 font-medium' : 'text-white'}>
                    {shippingFee === 0 ? 'FREE' : formatZAR(shippingFee)}
                  </span>
                </div>
                {cartSubtotal < SHIPPING_THRESHOLD && (
                  <p className="text-muted text-xs bg-border/50 rounded p-2">
                    Add {formatZAR(SHIPPING_THRESHOLD - cartSubtotal)} more for free shipping
                  </p>
                )}
              </div>

              <div className="flex justify-between pt-4 border-t border-border mb-6">
                <span className="text-white font-semibold">Total</span>
                <span className="text-gold font-bold text-xl">{formatZAR(total)}</span>
              </div>

              <Link to="/checkout" className="btn-gold w-full py-4 text-center block text-sm uppercase tracking-widest">
                Proceed to Checkout
              </Link>
            </div>

            <WhatsAppOrderPanel />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
