import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useCart } from '../context/CartContext'
import { supabase } from '../lib/supabase'
import { db } from '../lib/firebase'
import { ref, set } from 'firebase/database'
import CheckoutForm from '../components/checkout/CheckoutForm'
import OrderSummary, { SHIPPING_FEE, SHIPPING_THRESHOLD } from '../components/checkout/OrderSummary'
import PaystackButton from '../components/checkout/PaystackButton'
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
  const [processing, setProcessing] = useState(false)
  const navigate = useNavigate()

  const shippingFee = cartSubtotal >= SHIPPING_THRESHOLD ? 0 : SHIPPING_FEE
  const total = cartSubtotal + shippingFee

  useEffect(() => {
    document.title = 'Checkout | 224 Clubhouse'
    if (items.length === 0) navigate('/cart')
  }, [items, navigate])

  const handlePaystackSuccess = async (reference) => {
    setProcessing(true)
    try {
      // 1. Insert order
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert({
          customer_name: form.name,
          customer_email: form.email,
          customer_phone: form.phone,
          items: items.map(i => ({ id: i.id, name: i.name, price: i.price, quantity: i.quantity, slug: i.slug })),
          subtotal: cartSubtotal,
          shipping_fee: shippingFee,
          total,
          status: 'paid',
          paystack_reference: reference.reference,
          shipping_address: {
            street: form.street,
            apartment: form.apartment,
            city: form.city,
            province: form.province,
            postalCode: form.postalCode,
          },
        })
        .select()
        .single()

      if (orderError) throw orderError

      // 2. Decrement stock
      await Promise.all(items.map(item =>
        supabase.rpc('decrement_stock', { product_id: item.id, qty: item.quantity })
          .catch(() => null) // fail silently if RPC not set up yet
      ))

      // 3. Write to Firebase
      await set(ref(db, `orders/${order.id}`), {
        status: 'paid',
        updatedAt: new Date().toISOString(),
      })

      // 4. Send order confirmation email
      await supabase.functions.invoke('send-order-email', {
        body: {
          orderId: order.id,
          customerName: form.name,
          customerEmail: form.email,
          items: order.items,
          total: order.total,
          paystack_reference: reference.reference,
        },
      })

      // 5. Clear cart and navigate
      clearCart()
      navigate(`/order-confirmation/${order.id}`)
    } catch (err) {
      toast.error('Something went wrong processing your order. Please contact us.')
      console.error(err)
    } finally {
      setProcessing(false)
    }
  }

  const handlePayClick = () => {
    const validationErrors = validate(form)
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      toast.error('Please fill in all required fields')
      return false
    }
    if (!agreed) {
      toast.error('Please confirm you are 21 or older')
      return false
    }
    setErrors({})
    return true
  }

  if (items.length === 0) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="min-h-screen pt-28 pb-20"
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

            {/* Pay button */}
            <div className="bg-surface border border-border rounded-xl p-6">
              {processing ? (
                <div className="flex items-center justify-center gap-3 py-4 text-muted">
                  <div className="w-5 h-5 border-2 border-gold border-t-transparent rounded-full animate-spin" />
                  Processing your order...
                </div>
              ) : (
                <div onClick={() => { if (!handlePayClick()) return }}>
                  {agreed && Object.keys(errors).length === 0 ? (
                    <PaystackButton
                      amount={total}
                      email={form.email}
                      name={form.name}
                      phone={form.phone}
                      onSuccess={handlePaystackSuccess}
                      onClose={() => toast('Payment cancelled')}
                      disabled={!agreed}
                    />
                  ) : (
                    <button
                      onClick={handlePayClick}
                      className="btn-gold w-full py-4 text-base"
                    >
                      Review & Pay {new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(total / 100)}
                    </button>
                  )}
                </div>
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
    </motion.div>
  )
}
