import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Lock, Tag, X } from 'lucide-react'
import { useCart } from '../context/CartContext'
import { useAuth } from '../context/AuthContext'
import { useLastOrder } from '../hooks/useMyOrders'
import { useMyMembership } from '../hooks/useMyMembership'
import { useDiscountCode } from '../hooks/useDiscountCode'
import { memberPurchaseGate } from '../utils/memberGate'
import { supabase } from '../lib/supabase'
import CheckoutForm from '../components/checkout/CheckoutForm'
import CustomerAuth from '../components/auth/CustomerAuth'
import OrderSummary, { SHIPPING_FEE, SHIPPING_THRESHOLD } from '../components/checkout/OrderSummary'
import PaymentMethodSelect from '../components/checkout/PaymentMethodSelect'
// Paystack is disabled while the online paygate is being confirmed (PaystackButton.jsx retained for re-enable).
import { paymentLabel } from '../utils/orderStatus'
import { formatZAR } from '../utils/formatCurrency'
import { rememberOrder } from '../utils/recentOrders'
import toast from 'react-hot-toast'

const emptyForm = {
  name: '', email: '', phone: '',
  street: '', apartment: '', city: '', province: '', postalCode: '',
}

function validate(form) {
  const errors = {}
  if (!form.name.trim()) errors.name = 'Full name is required'
  if (!form.email.trim() || !/\S+@\S+\.\S+/.test(form.email)) errors.email = 'Valid email required'
  if (!form.phone.trim()) errors.phone = 'Phone number is required'
  if (!form.street.trim()) errors.street = 'Street address is required'
  if (!form.city.trim()) errors.city = 'City is required'
  if (!form.province) errors.province = 'Province is required'
  if (!form.postalCode.trim()) errors.postalCode = 'Postal code is required'
  return errors
}

export default function Checkout() {
  const { items, cartSubtotal, clearCart } = useCart()
  const { user, loading: authLoading } = useAuth()
  const [form, setForm] = useState(emptyForm)
  const [errors, setErrors] = useState({})
  const [agreed, setAgreed] = useState(false)
  const [method, setMethod] = useState('cash_on_delivery')
  const [processing, setProcessing] = useState(false)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // Discount codes: the client only ever holds a CODE. place_cod_order
  // re-derives the amount from its own DB-priced subtotal, so everything
  // below is display-only (see useDiscountCode).
  const [codeInput, setCodeInput] = useState('')
  const discount = useDiscountCode(cartSubtotal)

  // Free shipping is decided on the PRE-discount subtotal, exactly as the RPC
  // does — otherwise applying a code could push a cart back under R500 and
  // silently add R80 of shipping, leaving the customer worse off.
  const shippingFee = cartSubtotal >= SHIPPING_THRESHOLD ? 0 : SHIPPING_FEE
  const total = cartSubtotal - discount.discountCents + shippingFee

  // place_cod_order rejects the WHOLE order if any line is member-only and the
  // buyer isn't an active member. Catch it here instead, so the last step of
  // checkout can't end in a raw RPC error. Cart.jsx blocks the same case first;
  // this covers a direct /checkout hit or a membership lapsing mid-session.
  // Never blocks while the membership query is still loading (see memberGate).
  const membership = useMyMembership()
  const gate = memberPurchaseGate(user, membership)
  const lockedItems = items.filter(item => gate.isLocked(item))

  useEffect(() => {
    document.title = 'Checkout | 224 Clubhouse'
    if (items.length === 0) navigate('/cart')
  }, [items, navigate])

  // Returning customers shouldn't retype their delivery details. Until the
  // customer touches the form, empty fields DISPLAY values from their most
  // recent order (derived below — no effect, no state write on data arrival).
  // The first edit snapshots the merged form into state (CheckoutForm hands
  // back the whole form object), so nothing typed is ever overwritten and a
  // field the customer clears stays cleared.
  const { data: lastOrder } = useLastOrder()
  const [formTouched, setFormTouched] = useState(false)
  const handleFormChange = (next) => {
    setFormTouched(true)
    setForm(next)
  }
  const lastAddr = lastOrder?.shipping_address ?? {}
  const prefill = {
    name: lastOrder?.customer_name ?? '',
    phone: lastOrder?.customer_phone ?? '',
    street: lastAddr.street ?? '',
    apartment: lastAddr.apartment ?? '',
    city: lastAddr.city ?? '',
    province: lastAddr.province ?? '',
    postalCode: lastAddr.postalCode ?? '',
  }
  const baseForm = formTouched
    ? form
    : Object.fromEntries(
        Object.entries(form).map(([k, v]) => [k, v !== '' ? v : (prefill[k] ?? '')]),
      )

  // The server stamps the order with the ACCOUNT email (place_cod_order
  // overrides whatever the client sends), so the form mirrors it read-only —
  // derived here rather than synced into state.
  const checkoutForm = { ...baseForm, email: user?.email ?? '' }

  const handlePlaceOrder = async () => {
    if (processing) return // guard against double-submit -> duplicate orders
    if (!user) return // render gate should prevent this; server enforces regardless
    if (lockedItems.length > 0) return // button is disabled; the RPC would reject the whole order
    const validationErrors = validate(checkoutForm)
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      toast.error('Please fill in all required fields')
      return
    }
    if (!agreed) {
      toast.error('Please confirm you are 21 or older')
      return
    }
    if (!method) {
      toast.error('Please choose a payment method')
      return
    }
    setErrors({})

    setProcessing(true)
    const { data, error } = await supabase.rpc('place_cod_order', {
      p_customer: {
        name: checkoutForm.name,
        email: checkoutForm.email,
        phone: checkoutForm.phone,
        street: checkoutForm.street,
        apartment: checkoutForm.apartment,
        city: checkoutForm.city,
        province: checkoutForm.province,
        postalCode: checkoutForm.postalCode,
      },
      p_items: items.map(i => ({ id: i.id, quantity: i.quantity })),
      p_payment_method: method,
      // Code only — never an amount. The server recomputes what it's worth.
      p_discount_code: discount.applied?.code ?? null,
    })

    if (error || !data?.order_number) {
      // The RPC prefixes discount rejections so a code that expired, ran out,
      // or stopped being this account's first order between Apply and Place
      // Order reads as a sentence about the code — and gets cleared — instead
      // of a raw Postgres error on a cart the customer can still check out.
      const discountReason = /^Discount code:\s*/i.test(error?.message ?? '')
        ? error.message.replace(/^Discount code:\s*/i, '')
        : null
      if (discountReason) {
        discount.reject(discountReason)
        setCodeInput('')
        toast.error(`${discountReason}. The code has been removed — please place your order again.`)
      } else {
        toast.error(error?.message || 'Could not place your order. Please try again.')
      }
      setProcessing(false)
      return
    }

    // Remember it on this device BEFORE navigating: the order number otherwise only
    // exists in router state, so a refresh loses the one thing needed to track it.
    rememberOrder({
      orderNumber: data.order_number,
      email: checkoutForm.email,
      total: data.total,
      itemCount: items.reduce((n, i) => n + i.quantity, 0),
    })

    // Receipt email — fire and forget. The order is already placed; if Resend is
    // misconfigured or slow the customer must still reach their confirmation page,
    // so this never blocks navigation and never surfaces an error to them.
    // Only the order id goes over the wire: the function reads the recipient,
    // name, items and total from the row itself (and checks the caller owns it),
    // so a caller can never aim a branded email at an address of their choosing.
    supabase.functions
      .invoke('send-order-email', {
        body: { orderId: data.id },
      })
      .catch(() => {
        /* the order stands with or without the receipt */
      })

    // The customer's order list is cached; make the new order show up on /orders.
    queryClient.invalidateQueries({ queryKey: ['my-orders'] })

    clearCart()
    navigate(`/order-confirmation/${data.order_number}`, {
      state: { order: data, items, customer: checkoutForm, paymentMethod: method },
    })
  }

  if (items.length === 0) return null

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div
      className="min-h-screen pt-28 pb-20 animate-fadeIn"
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-10">
          <p className="text-gold text-xs uppercase tracking-[0.4em] mb-2">Final Step</p>
          <h1 className="font-heading text-4xl font-bold text-white">Checkout</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          {/* Form — or sign-in, since orders are tied to an account */}
          {!user ? (
            <div className="lg:col-span-3">
              <CustomerAuth
                title="Sign in to check out"
                subtitle="You need an account so your orders are saved and you can track them any time."
              />
            </div>
          ) : (
          <div className="lg:col-span-3 space-y-6">
            <div className="bg-surface border border-border rounded-xl p-6">
              <h2 className="font-semibold text-white mb-6 uppercase tracking-widest text-sm">
                Contact & Delivery
              </h2>
              <CheckoutForm form={checkoutForm} onChange={handleFormChange} errors={errors} lockEmail />
            </div>

            {/* Age confirmation */}
            <div className="bg-surface border border-border rounded-xl p-6">
              <label className="flex items-start gap-3 cursor-pointer">
                <div
                  onClick={() => setAgreed(a => !a)}
                  className={`flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center mt-0.5 transition-colors ${
                    agreed ? 'bg-gold border-gold' : 'border-border hover:border-gold'
                  }`}
                >
                  {agreed && <span className="text-black text-xs font-bold">✓</span>}
                </div>
                <span className="text-muted text-sm leading-relaxed">
                  I confirm that I am <span className="text-white font-semibold">21 years of age or older</span> and agree to the{' '}
                  <Link to="/terms" className="text-gold hover:text-gold-light underline transition-colors">terms of service</Link>, including the{' '}
                  <Link to="/privacy" className="text-gold hover:text-gold-light underline transition-colors">Privacy Policy</Link>. I understand that cannabis products are intended for adults only.
                </span>
              </label>
            </div>

            {/* Payment method */}
            <div className="bg-surface border border-border rounded-xl p-6">
              <h2 className="font-semibold text-white mb-6 uppercase tracking-widest text-sm">
                Payment Method
              </h2>
              <PaymentMethodSelect value={method} onChange={setMethod} />
            </div>

            {/* Place order */}
            <div className="bg-surface border border-border rounded-xl p-6">
              {processing ? (
                <div className="flex items-center justify-center gap-3 py-4 text-muted">
                  <div className="w-5 h-5 border-2 border-gold border-t-transparent rounded-full animate-spin" />
                  Processing your order...
                </div>
              ) : (
                <>
                  {lockedItems.length > 0 && (
                    <div className="border border-gold/40 bg-gold/5 rounded-lg p-4 mb-4 flex items-start gap-3">
                      <Lock size={16} className="text-gold mt-0.5 shrink-0" />
                      <p className="text-muted text-sm leading-relaxed">
                        <span className="text-white font-semibold">Members only:</span>{' '}
                        {lockedItems.map(i => i.name).join(', ')}{' '}
                        {lockedItems.length > 1 ? 'are' : 'is'} reserved for active members.{' '}
                        <Link to="/cart" className="text-gold hover:text-gold-light underline transition-colors">
                          Remove {lockedItems.length > 1 ? 'them' : 'it'} from your cart
                        </Link>{' '}
                        or{' '}
                        <Link to="/membership" className="text-gold hover:text-gold-light underline transition-colors">
                          join 224
                        </Link>{' '}
                        to place this order.
                      </p>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={handlePlaceOrder}
                    disabled={lockedItems.length > 0}
                    className="btn-gold w-full py-4 text-base"
                  >
                    Place Order — {formatZAR(total)}
                  </button>
                  <p className="text-muted text-xs text-center mt-3">
                    No payment now — you'll pay by {method ? paymentLabel(method) : 'cash/card'} when your order is delivered.
                  </p>
                </>
              )}
            </div>
          </div>
          )}

          {/* Summary */}
          <div className="lg:col-span-2">
            <div className="sticky top-28">
              <OrderSummary
                items={items}
                subtotal={cartSubtotal}
                discountCents={discount.discountCents}
                discountCode={discount.applied?.code ?? null}
              >
                {/* Discount code — signed-in only: validate_discount_code is
                    granted to `authenticated`, and checkout requires an
                    account anyway. */}
                {user && (
                  <div>
                    <label htmlFor="discount-code" className="block text-muted text-xs uppercase tracking-widest mb-2">
                      Discount code
                    </label>
                    {discount.applied ? (
                      <div className="flex items-center gap-3 border border-gold/40 bg-gold/5 rounded-lg px-3 py-2.5">
                        <Tag size={15} className="text-gold shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-sm font-semibold truncate">{discount.applied.code}</p>
                          <p className="text-gold text-xs">−{formatZAR(discount.discountCents)} applied</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => { discount.remove(); setCodeInput('') }}
                          className="text-muted hover:text-red-400 transition-colors p-1 shrink-0"
                          aria-label="Remove discount code"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    ) : (
                      <form
                        onSubmit={(e) => { e.preventDefault(); discount.apply(codeInput) }}
                        className="flex gap-2"
                      >
                        <input
                          id="discount-code"
                          value={codeInput}
                          onChange={e => setCodeInput(e.target.value.toUpperCase())}
                          placeholder="WELCOME10"
                          autoComplete="off"
                          maxLength={40}
                          className="input-base text-sm py-2.5 uppercase tracking-widest"
                        />
                        <button
                          type="submit"
                          disabled={discount.checking || !codeInput.trim()}
                          className="btn-outline text-sm px-5 py-2.5 shrink-0"
                        >
                          {discount.checking ? 'Checking...' : 'Apply'}
                        </button>
                      </form>
                    )}
                    {discount.error && (
                      <p className="text-red-400 text-xs mt-2">{discount.error}</p>
                    )}
                  </div>
                )}
              </OrderSummary>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
