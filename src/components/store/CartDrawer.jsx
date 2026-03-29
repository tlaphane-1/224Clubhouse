import { motion, AnimatePresence } from 'framer-motion'
import { X, Trash2, ShoppingBag } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useCart } from '../../context/CartContext'
import { formatZAR } from '../../utils/formatCurrency'

export default function CartDrawer({ isOpen, onClose }) {
  const { items, removeItem, updateQuantity, cartSubtotal } = useCart()

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[80] flex justify-end">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'tween', duration: 0.3 }}
            className="relative w-full max-w-md bg-surface border-l border-border flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-border">
              <h3 className="font-heading text-xl font-semibold text-white">Your Cart</h3>
              <button onClick={onClose} className="text-muted hover:text-white transition-colors">
                <X size={20} />
              </button>
            </div>

            {/* Items */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {items.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center py-12">
                  <ShoppingBag size={40} className="text-muted mb-4" />
                  <p className="text-muted">Your cart is empty</p>
                </div>
              ) : (
                items.map(item => (
                  <div key={item.id} className="flex gap-3 p-3 bg-background rounded-lg border border-border">
                    <div className="w-16 h-16 rounded-lg bg-surface flex-shrink-0 overflow-hidden">
                      {item.images?.[0] ? (
                        <img src={item.images[0]} alt={item.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <span className="text-gold/30 font-heading font-bold text-sm">224</span>
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium truncate">{item.name}</p>
                      <p className="text-gold text-sm font-bold mt-0.5">{formatZAR(item.price)}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <button
                          onClick={() => updateQuantity(item.id, item.quantity - 1)}
                          className="w-6 h-6 rounded bg-border flex items-center justify-center text-white hover:bg-gold hover:text-black transition-colors text-xs"
                        >
                          −
                        </button>
                        <span className="text-white text-sm w-6 text-center">{item.quantity}</span>
                        <button
                          onClick={() => updateQuantity(item.id, item.quantity + 1)}
                          className="w-6 h-6 rounded bg-border flex items-center justify-center text-white hover:bg-gold hover:text-black transition-colors text-xs"
                        >
                          +
                        </button>
                      </div>
                    </div>
                    <button
                      onClick={() => removeItem(item.id)}
                      className="text-muted hover:text-red-400 transition-colors self-start mt-1"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Footer */}
            {items.length > 0 && (
              <div className="p-6 border-t border-border space-y-4">
                <div className="flex justify-between text-white">
                  <span className="text-muted">Subtotal</span>
                  <span className="font-semibold">{formatZAR(cartSubtotal)}</span>
                </div>
                <Link
                  to="/checkout"
                  onClick={onClose}
                  className="btn-gold w-full text-center py-4 rounded-lg block"
                >
                  Checkout
                </Link>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
