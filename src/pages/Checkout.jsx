import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCart } from '../context/CartContext'
import { supabase } from '../lib/supabase'
import CheckoutForm from '../components/checkout/CheckoutForm'
import OrderSummary, { SHIPPING_FEE, SHIPPING_THRESHOLD } from '../components/checkout/OrderSummary'
import PaymentMethodSelect from '../components/checkout/PaymentMethodSelect'
// Paystack is disabled while the online paygate is being confirmed (PaystackButton.jsx retained for re-enable).
import { paymentLabel } from '../utils/orderStatus'
import { formatZAR } from '../utils/formatCurrency'
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
  const [form, setForm] = useState(emptyForm)
  const [errors, setErrors] = useState({})
  const [agreed, setAgreed] = useState(false)
  const [method, setMethod] = useState('cash_on_delivery')
  const [processing, setProcessing] = useState(false)
  const navigate = useNavigate()

  const shippingFee = cartSubtotal >= SHIPPING_THRESHOLD ? 0 : SHIPPING_FEE
  const total = cartSubtotal + shippingFee

  useEffect(() => {
    document.title = 'Checkout | 224 Clubhouse'
    if (items.length === 0) navigate('/cart')
  }, [items, navigate])

  const handlePlaceOrder = async () => {
    const validationErrors = validate(form)
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
        name: form.name,
        email: form.email,
        phone: form.phone,
        street: form.street,
        apartment: form.apartment,
        city: form.city,
        province: form.province,
        postalCode: form.postalCode,
      },
      p_items: items.map(i => ({ id: i.id, quantity: i.quantity })),
      p_payment_method: method,
    })

    if (error) {
      toast.error(error.message || 'Could not place your order. Please try again.')
      setProcessing(false)
      return
    }

    clearCart()
    navigate(`/order-confirmation/${data.order_number}`, {
      state: { order: data, items, customer: form, paymentMethod: method },
    })
  }

  if (items.length === 0) return null

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
          {/* Form */}
          <div className="lg:col-span-3 space-y-6">
            <div className="bg-surface border border-border rounded-xl p-6">
              <h2 className="font-semibold text-white mb-6 uppercase tracking-widest text-sm">
                Contact & Delivery
              </h2>
              <CheckoutForm form={form} onChange={setForm} errors={errors} />
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
                  <span className="text-gold">terms of service</span>. I understand that cannabis products are intended for adults only.
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
                  <button
                    type="button"
                    onClick={handlePlaceOrder}
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

          {/* Summary */}
          <div className="lg:col-span-2">
            <div className="sticky top-28">
              <OrderSummary items={items} subtotal={cartSubtotal} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
