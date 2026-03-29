import { useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { CheckCircle, Package } from 'lucide-react'
import { useOrder } from '../hooks/useOrders'
import { useOrderStatus } from '../hooks/useOrderStatus'
import Badge from '../components/ui/Badge'
import { formatZAR } from '../utils/formatCurrency'

export default function OrderConfirmation() {
  const { id } = useParams()
  const { data: order, isLoading } = useOrder(id)
  const liveStatus = useOrderStatus(id)
  const status = liveStatus || order?.status

  useEffect(() => {
    document.title = 'Order Confirmed | 224 Clubhouse'
  }, [])

  if (isLoading) {
    return (
      <div className="min-h-screen pt-28 flex items-center justify-center">
        <div className="text-muted animate-pulse">Loading your order...</div>
      </div>
    )
  }

  if (!order) {
    return (
      <div className="min-h-screen pt-28 flex flex-col items-center justify-center">
        <h2 className="font-heading text-2xl text-white mb-4">Order not found</h2>
        <Link to="/store" className="text-gold hover:text-gold-light">Back to Store</Link>
      </div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="min-h-screen pt-28 pb-20"
    >
      <div className="max-w-2xl mx-auto px-4">
        {/* Success Header */}
        <div className="text-center mb-10">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', duration: 0.6, delay: 0.2 }}
            className="inline-flex"
          >
            <CheckCircle size={64} className="text-green-400" strokeWidth={1.5} />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
          >
            <h1 className="font-heading text-3xl font-bold text-white mt-4 mb-2">Order Confirmed!</h1>
            <p className="text-muted">Thank you, {order.customer_name.split(' ')[0]}. We've received your order.</p>
          </motion.div>
        </div>

        {/* Order Card */}
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          {/* Order Ref */}
          <div className="p-6 border-b border-border flex items-center justify-between">
            <div>
              <p className="text-muted text-xs uppercase tracking-widest mb-1">Order Reference</p>
              <p className="font-mono text-gold font-semibold text-sm">{order.paystack_reference}</p>
            </div>
            <div className="text-right">
              <p className="text-muted text-xs uppercase tracking-widest mb-1">Status</p>
              <Badge variant={status}>{status}</Badge>
            </div>
          </div>

          {/* Live Status */}
          {liveStatus && (
            <div className="px-6 py-3 bg-gold/5 border-b border-border flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-green-400 text-xs">Live order tracking active</span>
            </div>
          )}

          {/* Items */}
          <div className="p-6 border-b border-border">
            <h3 className="text-white font-semibold text-sm uppercase tracking-widest mb-4">Items Ordered</h3>
            <div className="space-y-3">
              {order.items?.map((item, i) => (
                <div key={i} className="flex justify-between text-sm">
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
              <span className="text-white font-semibold">Total Paid</span>
              <span className="text-gold font-bold text-lg">{formatZAR(order.total)}</span>
            </div>
          </div>

          {/* Delivery */}
          <div className="p-6 flex items-center gap-3">
            <Package size={20} className="text-gold flex-shrink-0" />
            <div>
              <p className="text-white text-sm font-medium">Estimated Delivery</p>
              <p className="text-muted text-xs mt-0.5">2–5 business days to {order.shipping_address?.city}</p>
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="text-center mt-8">
          <Link to="/store" className="btn-gold px-8 py-3 inline-flex items-center gap-2 text-sm uppercase tracking-widest">
            Continue Shopping
          </Link>
        </div>
      </div>
    </motion.div>
  )
}
