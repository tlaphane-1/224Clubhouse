import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { LogOut, Package, AlertTriangle } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useMyOrders } from '../hooks/useMyOrders'
import CustomerAuth from '../components/auth/CustomerAuth'
import { formatZAR } from '../utils/formatCurrency'
import { statusLabel } from '../utils/orderStatus'

// Customer-facing order history ("Orders" in the navbar). The admin order
// manager is a different page (pages/admin/Orders.jsx).
export default function MyOrders() {
  const { user, loading: authLoading, signOut } = useAuth()
  const { data: orders, isLoading, isError } = useMyOrders()

  useEffect(() => {
    document.title = 'My Orders | 224 Clubhouse'
  }, [])

  if (authLoading) {
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
          <p className="text-gold text-xs uppercase tracking-[0.3em] mb-3">Your Account</p>
          <h1 className="font-heading text-3xl md:text-4xl font-bold text-white">My Orders</h1>
          {!user && (
            <p className="text-muted text-sm mt-3">
              Sign in to see the orders on your account and track them from any device.
            </p>
          )}
        </div>

        {!user ? (
          <CustomerAuth
            title="Sign in to see your orders"
            subtitle="Your orders are saved to your account, so you can track them from any device."
          />
        ) : (
          <>
            {/* Account bar */}
            <div className="bg-surface border border-border rounded-2xl p-4 mb-8 flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-muted text-xs uppercase tracking-widest mb-0.5">Signed in as</p>
                <p className="text-white text-sm truncate">{user.email}</p>
              </div>
              <button
                type="button"
                onClick={signOut}
                className="btn-outline px-4 py-2 text-xs uppercase tracking-widest inline-flex items-center gap-2"
              >
                <LogOut size={14} />
                Sign Out
              </button>
            </div>

            {/* Orders */}
            {isLoading && (
              <div className="flex justify-center py-12">
                <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
              </div>
            )}

            {isError && (
              <div className="bg-surface border border-red-500/20 rounded-2xl p-6 text-center">
                <AlertTriangle size={28} className="text-red-400 mx-auto mb-3" />
                <p className="text-white text-sm">
                  Something went wrong loading your orders. Please try again in a moment.
                </p>
              </div>
            )}

            {!isLoading && !isError && (orders ?? []).length === 0 && (
              <div className="bg-surface border border-border rounded-2xl p-8 text-center">
                <Package size={28} className="text-muted mx-auto mb-3" />
                <p className="text-white text-sm mb-1">No orders yet</p>
                <p className="text-muted text-xs mb-6">
                  When you place an order, it will show up here.
                </p>
                <Link to="/store" className="btn-gold px-6 py-3 text-xs uppercase tracking-widest">
                  Browse the Store
                </Link>
              </div>
            )}

            {(orders ?? []).length > 0 && (
              <div className="bg-surface border border-border rounded-2xl p-6">
                <h2 className="text-white font-semibold text-sm uppercase tracking-widest mb-1">
                  Your orders
                </h2>
                <p className="text-muted text-xs mb-4">
                  {orders.length} order{orders.length === 1 ? '' : 's'} · newest first
                </p>
                <ul className="space-y-2">
                  {orders.map((o) => (
                    <li
                      key={o.id}
                      className="flex items-center justify-between gap-3 flex-wrap border border-border rounded-xl p-3"
                    >
                      <div className="min-w-0">
                        <p className="font-mono text-gold text-sm font-semibold">{o.order_number}</p>
                        <p className="text-muted text-xs mt-0.5">
                          {new Date(o.created_at).toLocaleDateString('en-ZA')}
                          {' · '}{formatZAR(o.total)}
                          {Array.isArray(o.items) && o.items.length > 0 &&
                            ` · ${o.items.length} item${o.items.length === 1 ? '' : 's'}`}
                          {' · '}{statusLabel(o.status)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Link
                          to={`/orders/${o.id}`}
                          className="btn-gold px-4 py-2 text-xs uppercase tracking-widest"
                        >
                          View
                        </Link>
                        <Link
                          to={`/track?order=${o.order_number}`}
                          className="btn-outline px-4 py-2 text-xs uppercase tracking-widest"
                        >
                          Track
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="text-muted text-xs mt-6 text-center">
              Placed an order before creating your account? Find it with{' '}
              <Link to="/track" className="text-gold hover:underline">Track Order</Link>{' '}
              using the email you checked out with.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
