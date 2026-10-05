import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Crown, Lock, Tag, X } from 'lucide-react'
import { useCart } from '../context/useCart'
import { useAuth } from '../context/useAuth'
import { useLastOrder, useMyOrders } from '../hooks/useMyOrders'
import { useMyMembership } from '../hooks/useMyMembership'
import { useDiscountCode } from '../hooks/useDiscountCode'
import { memberPurchaseGate } from '../utils/memberGate'
import { supabase } from '../lib/supabase'
import CheckoutForm from '../components/checkout/CheckoutForm'
import { CHECKOUT_FIELD_ORDER, checkoutFieldId } from '../components/checkout/checkoutFields'
import StickyActionBar from '../components/ui/StickyActionBar'
import Checkbox from '../components/ui/Checkbox'
import { focusField } from '../utils/focusField'
import CustomerAuth from '../components/auth/CustomerAuth'
import OrderSummary from '../components/checkout/OrderSummary'
import Modal from '../components/ui/Modal'
import { shippingFeeFor } from '../utils/shipping'
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
  // Phones show the order summary collapsed behind a total bar (desktop: always open).
  const [summaryOpen, setSummaryOpen] = useState(false)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // Discount codes: the client only ever holds a CODE. place_cod_order
  // re-derives the amount from its own DB-priced subtotal, so everything
  // below is display-only (see useDiscountCode).
  const [codeInput, setCodeInput] = useState('')
  const discount = useDiscountCode(cartSubtotal)

  // place_cod_order rejects the WHOLE order if any line is member-only and the
  // buyer isn't an active member. Catch it here instead, so the last step of
  // checkout can't end in a raw RPC error. Cart.jsx blocks the same case first;
  // this covers a direct /checkout hit or a membership lapsing mid-session.
  // Never blocks while the membership query is still loading (see memberGate).
  const membership = useMyMembership()
  const gate = memberPurchaseGate(user, membership)
  const lockedItems = items.filter(item => gate.isLocked(item))

  // Free delivery for active members; otherwise free at R500+ judged on the
  // PRE-discount subtotal, exactly as the RPC does — so applying a code can
  // never push a cart back under R500 and add delivery back on.
  const shippingFee = shippingFeeFor(cartSubtotal, gate.isActiveMember)
  const total = cartSubtotal - discount.discountCents + shippingFee

  // After a first (non-cancelled) order, place_cod_order requires a membership
  // application (pending or active). Mirror it so the customer gets the
  // become-a-member prompt instead of a raw RPC error. Only decided once both
  // queries have settled — never blocks on loading.
  const myOrders = useMyOrders()
  const needsMembership =
    Boolean(myOrders.data?.some(o => o.status !== 'cancelled')) &&
    membership.isSuccess &&
    !membership.current
  const [showJoinPrompt, setShowJoinPrompt] = useState(false)

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
    if (needsMembership) {
      setShowJoinPrompt(true)
      return
    }
    const validationErrors = validate(checkoutForm)
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      toast.error('Please fill in all required fields')
      // On a phone the first problem is usually off-screen above the button.
      const firstInvalid = CHECKOUT_FIELD_ORDER.find(key => validationErrors[key])
      if (firstInvalid) focusField(checkoutFieldId(firstInvalid))
      return
    }
    if (!agreed) {
      toast.error('Please confirm you are 21 or older')
      focusField('checkout-agree')
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
      // variant_id only for products sold in options; the server prices the option.
      p_items: items.map(i => (i.variant_id
        ? { id: i.id, variant_id: i.variant_id, quantity: i.quantity }
        : { id: i.id, quantity: i.quantity })),
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
      if (/^Membership required:/i.test(error?.message ?? '')) {
        setShowJoinPrompt(true)
      } else if (discountReason) {
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

  const itemCount = items.reduce((n, i) => n + i.quantity, 0)
  const paymentNote = method === 'eft'
    ? "No payment now — we'll show our banking details after you place your order."
    : `No payment now — you'll pay by ${method ? paymentLabel(method) : 'cash/card'} on delivery.`

  // One place-order control, rendered inline on desktop and in the phone's
  // sticky bar (each copy hidden at the other size).
  const placeOrderAction = processing ? (
    <div className="flex items-center justify-center gap-3 py-4 text-muted" role="status">
      <div className="w-5 h-5 border-2 border-gold border-t-transparent rounded-full animate-spin" />
      Placing your order...
    </div>
  ) : (
    <button
      type="button"
      onClick={handlePlaceOrder}
      disabled={lockedItems.length > 0}
      className="btn-gold w-full py-4 text-base"
    >
      Place Order — {formatZAR(total)}
    </button>
  )

  // Discount code — signed-in only: validate_discount_code is granted to
  // `authenticated`, and checkout requires an account anyway.
  const discountField = user && (
    <div>
      <label htmlFor="discount-code" className="block text-muted text-xs uppercase tracking-widest mb-2">
        Discount code
      </label>
      {discount.applied ? (
        <div className="flex items-center gap-3 border border-gold/40 bg-gold/5 rounded-lg pl-3">
          <Tag size={15} className="text-gold shrink-0" />
          <div className="flex-1 min-w-0 py-2.5">
            <p className="text-white text-sm font-semibold truncate">{discount.applied.code}</p>
            <p className="text-gold text-xs">−{formatZAR(discount.discountCents)} applied</p>
          </div>
          <button
            type="button"
            onClick={() => { discount.remove(); setCodeInput('') }}
            className="focus-ring w-11 h-11 flex items-center justify-center text-muted hover:text-red-400 transition-colors rounded-lg shrink-0"
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
            autoCapitalize="characters"
            maxLength={40}
            className="input-base text-sm py-2.5 uppercase tracking-widest"
          />
          <button
            type="submit"
            disabled={discount.checking || !codeInput.trim()}
            className="btn-outline text-sm px-5 py-2.5 shrink-0 disabled:opacity-50"
          >
            {discount.checking ? 'Checking...' : 'Apply'}
          </button>
        </form>
      )}
      {discount.error && (
        <p className="text-red-400 text-xs mt-2">{discount.error}</p>
      )}
    </div>
  )

  const stepBadge = 'w-7 h-7 rounded-full bg-gold/10 text-gold flex items-center justify-center text-xs'
  const stepHeading = 'flex items-center gap-3 font-semibold text-white uppercase tracking-widest text-sm'

  return (
    // No transform on this wrapper: it is the sticky bar's containing block.
    <div className="min-h-screen pt-24 md:pt-28 lg:pb-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 animate-fadeIn">
        <div className="mb-5 md:mb-10">
          <p className="text-gold text-xs uppercase tracking-[0.4em] mb-2">Final Step</p>
          <h1 className="font-heading text-3xl md:text-4xl font-bold text-white">Checkout</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 lg:gap-8">
          {/* Summary — first on phones (a collapsible total bar), the right-hand column on desktop */}
          <div className="lg:order-last lg:col-span-2">
            <div className="lg:sticky lg:top-28">
              <button
                type="button"
                onClick={() => setSummaryOpen(o => !o)}
                aria-expanded={summaryOpen}
                aria-controls="checkout-summary"
                className="focus-ring lg:hidden w-full flex items-center justify-between gap-3 min-h-14 px-4
                           bg-surface border border-border rounded-xl text-left"
              >
                <span className="flex items-center gap-2 text-sm text-white">
                  {summaryOpen ? 'Hide' : 'Show'} order summary
                  <span className="text-muted">({itemCount} {itemCount === 1 ? 'item' : 'items'})</span>
                  <ChevronDown size={16} className={`text-gold transition-transform ${summaryOpen ? 'rotate-180' : ''}`} />
                </span>
                <span className="text-gold font-bold">{formatZAR(total)}</span>
              </button>
              <div id="checkout-summary" className={`${summaryOpen ? 'block mt-3' : 'hidden'} lg:block lg:mt-0`}>
                <OrderSummary
                  items={items}
                  subtotal={cartSubtotal}
                  discountCents={discount.discountCents}
                  discountCode={discount.applied?.code ?? null}
                  isMember={gate.isActiveMember}
                >
                  {discountField}
                </OrderSummary>
              </div>
            </div>
          </div>

          {/* Form — or sign-in, since orders are tied to an account */}
          {!user ? (
            <div className="lg:col-span-3 pb-12 lg:pb-0">
              <CustomerAuth
                title="Sign in to check out"
                subtitle="You need an account so your orders are saved and you can track them any time."
              />
            </div>
          ) : (
            <div className="lg:col-span-3 space-y-5 lg:space-y-6">
              <section className="bg-surface border border-border rounded-xl p-4 sm:p-6" aria-labelledby="checkout-step-1">
                <h2 id="checkout-step-1" className={`${stepHeading} mb-5 sm:mb-6`}>
                  <span className={stepBadge} aria-hidden="true">1</span>
                  Contact & Delivery
                </h2>
                <CheckoutForm form={checkoutForm} onChange={handleFormChange} errors={errors} lockEmail />
              </section>

              <section className="bg-surface border border-border rounded-xl p-4 sm:p-6" aria-labelledby="checkout-step-2">
                <h2 id="checkout-step-2" className={`${stepHeading} mb-5 sm:mb-6`}>
                  <span className={stepBadge} aria-hidden="true">2</span>
                  Payment Method
                </h2>
                <PaymentMethodSelect value={method} onChange={setMethod} />
              </section>

              <section className="bg-surface border border-border rounded-xl p-4 sm:p-6" aria-labelledby="checkout-step-3">
                <h2 id="checkout-step-3" className={`${stepHeading} mb-4`}>
                  <span className={stepBadge} aria-hidden="true">3</span>
                  Confirm
                </h2>
                <Checkbox id="checkout-agree" checked={agreed} onChange={setAgreed}>
                  <span className="text-muted">
                    I confirm that I am <span className="text-white font-semibold">21 years of age or older</span> and agree to the{' '}
                    <Link to="/terms" className="text-gold hover:text-gold-light underline transition-colors">terms of service</Link>, including the{' '}
                    <Link to="/privacy" className="text-gold hover:text-gold-light underline transition-colors">Privacy Policy</Link>. I understand that cannabis products are intended for adults only.
                  </span>
                </Checkbox>

                {lockedItems.length > 0 && (
                  <div className="border border-gold/40 bg-gold/5 rounded-lg p-4 mt-4 flex items-start gap-3">
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

                {/* Desktop place-order (phones use the sticky bar below) */}
                <div className="hidden lg:block mt-6">
                  {placeOrderAction}
                  <p className="text-muted text-xs text-center mt-3">{paymentNote}</p>
                </div>
              </section>
            </div>
          )}
        </div>
      </div>

      {/* Phone place-order bar — after the form in reading/focus order */}
      {user && (
        <StickyActionBar hideFrom="lg" className="mt-6">
          {placeOrderAction}
          <p className="text-muted text-xs text-center mt-2">{paymentNote}</p>
        </StickyActionBar>
      )}

      <Modal isOpen={showJoinPrompt} onClose={() => setShowJoinPrompt(false)} title="Become a member to order again" size="sm">
        <div className="text-center">
          <Crown size={36} className="text-gold mx-auto mb-4" />
          <p className="text-muted text-sm leading-relaxed mb-2">
            Thanks for your first order! 224 Clubhouse is a private members' club, so
            from your second order onwards you need a membership.
          </p>
          <p className="text-muted text-sm leading-relaxed mb-6">
            Apply in a minute — pay by EFT or with your next delivery. Members also get{' '}
            <span className="text-white font-semibold">free delivery</span>. Your cart is saved.
          </p>
          <Link to="/membership" className="btn-gold w-full py-3 block">Become a member</Link>
          <button
            type="button"
            onClick={() => setShowJoinPrompt(false)}
            className="focus-ring rounded-lg h-11 px-4 text-muted hover:text-white text-sm mt-2 transition-colors"
          >
            Not now
          </button>
        </div>
      </Modal>
    </div>
  )
}
