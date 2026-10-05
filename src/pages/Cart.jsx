import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Trash2, ShoppingBag, ArrowRight, Lock, Truck } from 'lucide-react'
import { useCart } from '../context/useCart'
import { useAuth } from '../context/useAuth'
import { useMyMembership } from '../hooks/useMyMembership'
import { useCheapestTier } from '../hooks/useMembershipTiers'
import { memberPurchaseGate } from '../utils/memberGate'
import { formatZAR } from '../utils/formatCurrency'
import { formatTierPrice } from '../utils/tierPrice'
import { SHIPPING_THRESHOLD, shippingFeeFor } from '../utils/shipping'
import WhatsAppOrderPanel from '../components/store/WhatsAppOrderPanel'
import StickyActionBar from '../components/ui/StickyActionBar'
import BrandLogo from '../components/ui/BrandLogo'

const STEPPER_BTN = `focus-ring w-11 h-11 flex items-center justify-center text-lg text-muted hover:text-white
                     active:scale-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all rounded-lg`

export default function Cart() {
  const { items, removeItem, updateQuantity, cartSubtotal } = useCart()
  const { user } = useAuth()
  const membership = useMyMembership()
  const cheapestTier = useCheapestTier()

  // Member-only lines the current viewer can't buy — the cart is persisted in
  // localStorage, so an item added while a membership was live can outlive it.
  // Checkout is held until they're removed; the server would reject the whole
  // order anyway, and much later. Never blocked while the membership query is
  // still loading (see memberGate).
  const gate = memberPurchaseGate(user, membership)
  const lockedItems = items.filter(item => gate.isLocked(item))
  const hasLockedItems = lockedItems.length > 0

  const shippingFee = shippingFeeFor(cartSubtotal, gate.isActiveMember)
  const total = cartSubtotal + shippingFee
  const itemCount = items.reduce((s, i) => s + i.quantity, 0)

  useEffect(() => {
    document.title = 'Cart | 224 Clubhouse'
  }, [])

  if (items.length === 0) {
    return (
      <div className="min-h-screen pt-28 flex flex-col items-center justify-center px-4">
        <div className="text-center animate-fadeIn">
          <ShoppingBag size={56} className="text-muted mx-auto mb-6" strokeWidth={1} />
          <h2 className="font-heading text-2xl font-semibold text-white mb-3">Your cart is empty</h2>
          <p className="text-muted mb-8">Add something from the store to get started.</p>
          <Link to="/store" className="btn-gold px-8 py-3">
            Continue Shopping <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    )
  }

  const checkoutAction = (label) => hasLockedItems ? (
    <button
      type="button"
      disabled
      className="btn-gold w-full py-4 text-sm uppercase tracking-widest"
    >
      {label}
    </button>
  ) : (
    <Link to="/checkout" className="btn-gold w-full py-4 text-sm uppercase tracking-widest">
      {label} <ArrowRight size={16} />
    </Link>
  )

  const lockedHint = hasLockedItems && (
    <p className="text-muted text-xs text-center mt-3 leading-relaxed">
      Remove the members-only {lockedItems.length > 1 ? 'items' : 'item'} above, or{' '}
      <Link to="/membership" className="text-gold underline underline-offset-2 hover:text-gold-light transition-colors">
        join 224
      </Link>{' '}
      to buy {lockedItems.length > 1 ? 'them' : 'it'}.
    </p>
  )

  return (
    // No transform on this wrapper: it is the sticky bar's containing block.
    <div className="min-h-screen pt-24 md:pt-28 pb-12 lg:pb-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 animate-fadeIn">
        <div className="mb-5 md:mb-10">
          <p className="text-gold text-xs uppercase tracking-[0.4em] mb-2">Review</p>
          <h1 className="font-heading text-3xl md:text-4xl font-bold text-white">
            Your Cart <span className="text-muted text-lg md:text-xl font-body font-normal">({itemCount})</span>
          </h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 lg:gap-8">
          {/* Items */}
          <div className="lg:col-span-2 space-y-3 sm:space-y-4">
            {items.map(item => {
              const locked = gate.isLocked(item)
              const atMax = item.stock_quantity != null && item.quantity >= item.stock_quantity
              return (
                <div
                  key={item.id}
                  className={`flex gap-3 sm:gap-4 p-3 sm:p-4 bg-surface border rounded-xl ${
                    locked ? 'border-gold/40' : 'border-border'
                  }`}
                >
                  {/* Image */}
                  <Link to={`/store/${item.slug}`} className="focus-ring rounded-lg flex-shrink-0" aria-label={item.name}>
                    <div className="w-20 h-20 rounded-lg bg-background overflow-hidden">
                      {item.images?.[0] ? (
                        <img src={item.images[0]} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <BrandLogo decorative className="w-3/4 opacity-30" />
                        </div>
                      )}
                    </div>
                  </Link>

                  {/* Details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-1">
                      <Link
                        to={`/store/${item.slug}`}
                        className="focus-ring rounded flex-1 min-w-0 py-3 -my-3 text-white font-semibold text-sm sm:text-base leading-snug line-clamp-2 hover:text-gold transition-colors"
                      >
                        {item.name}
                      </Link>
                      <button
                        type="button"
                        onClick={() => removeItem(item.id)}
                        aria-label={`Remove ${item.name} from cart`}
                        className="focus-ring flex-shrink-0 w-11 h-11 -mt-2.5 -mr-2 flex items-center justify-center rounded-lg
                                   text-muted hover:text-red-400 active:text-red-400 active:scale-90 transition-all"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                    <p className="text-gold text-sm font-bold">{formatZAR(item.price)}</p>

                    {locked && (
                      <p className="mt-2 flex items-center gap-1.5 text-xs text-gold">
                        <Lock size={12} className="shrink-0" />
                        Members only —{' '}
                        <Link to="/membership" className="underline underline-offset-2 hover:text-gold-light transition-colors">
                          join to purchase
                        </Link>
                      </p>
                    )}

                    <div className="flex items-center justify-between gap-3 mt-2">
                      <div className="flex items-center border border-border rounded-lg" role="group" aria-label={`Quantity of ${item.name}`}>
                        <button
                          type="button"
                          onClick={() => updateQuantity(item.id, item.quantity - 1)}
                          disabled={item.quantity <= 1}
                          aria-label="Decrease quantity"
                          className={STEPPER_BTN}
                        >
                          −
                        </button>
                        <span className="text-white text-sm w-7 text-center" aria-live="polite">{item.quantity}</span>
                        <button
                          type="button"
                          onClick={() => updateQuantity(item.id, item.quantity + 1)}
                          disabled={atMax}
                          aria-label="Increase quantity"
                          className={STEPPER_BTN}
                        >
                          +
                        </button>
                      </div>
                      <span className="text-white text-sm font-semibold">{formatZAR(item.price * item.quantity)}</span>
                    </div>
                  </div>
                </div>
              )
            })}

            <Link
              to="/store"
              className="focus-ring rounded-lg inline-flex items-center gap-2 h-11 text-muted hover:text-gold text-sm transition-colors"
            >
              ← Continue Shopping
            </Link>
          </div>

          {/* Order Summary */}
          <div>
            <div className="lg:sticky lg:top-28 bg-surface border border-border rounded-xl p-4 sm:p-6">
              <h2 className="font-heading text-lg font-semibold text-white mb-4 sm:mb-5">Order Summary</h2>

              <div className="space-y-3 mb-5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted">Subtotal ({itemCount} {itemCount === 1 ? 'item' : 'items'})</span>
                  <span className="text-white">{formatZAR(cartSubtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Delivery</span>
                  <span className={shippingFee === 0 ? 'text-green-400 font-medium' : 'text-white'}>
                    {shippingFee === 0 ? 'FREE' : formatZAR(shippingFee)}
                  </span>
                </div>
                {gate.isActiveMember ? (
                  <p className="flex items-center gap-2 text-green-400 text-xs">
                    <Truck size={14} className="shrink-0" /> Free delivery, your member benefit.
                  </p>
                ) : (
                  <div className="flex items-start gap-3 text-xs bg-leaf/5 border border-leaf/30 rounded-lg p-3 leading-relaxed">
                    <Truck size={16} className="text-leaf shrink-0 mt-0.5" />
                    <div>
                      <p className="text-white font-semibold mb-1">Members get free delivery</p>
                      <p className="text-muted">
                        <Link to="/membership" className="text-leaf underline underline-offset-2">
                          {cheapestTier ? `Join from ${formatTierPrice(cheapestTier.price_cents)}` : 'Become a member'}
                        </Link>
                        {shippingFee > 0 && <> — or add {formatZAR(SHIPPING_THRESHOLD - cartSubtotal)} more for free delivery</>}.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-between pt-4 border-t border-border lg:mb-6">
                <span className="text-white font-semibold">Total</span>
                <span className="text-gold font-bold text-xl">{formatZAR(total)}</span>
              </div>

              {/* Desktop checkout (phones use the sticky bar) */}
              <div className="hidden lg:block">
                {checkoutAction('Proceed to Checkout')}
                {lockedHint}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Phone checkout bar — after the summary in reading/focus order */}
      <StickyActionBar hideFrom="lg" className="mt-6">
        <div className="flex items-center gap-4">
          <div className="flex-shrink-0">
            <p className="text-muted text-xs">Total</p>
            <p className="text-gold font-bold text-lg leading-tight">{formatZAR(total)}</p>
          </div>
          <div className="flex-1">{checkoutAction('Checkout')}</div>
        </div>
        {lockedHint}
      </StickyActionBar>

      {/* The alternative path comes after the main one (all screen sizes) */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 mt-8">
        <div className="lg:w-1/3 lg:ml-auto lg:pl-3">
          <WhatsAppOrderPanel />
        </div>
      </div>
    </div>
  )
}
