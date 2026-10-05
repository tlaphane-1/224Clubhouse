import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Package, ShoppingCart, DollarSign, Clock, AlertTriangle } from 'lucide-react'
import AdminLayout from '../../components/admin/AdminLayout'
import StatsCard from '../../components/admin/StatsCard'
import OrdersTable from '../../components/admin/OrdersTable'
import { useOrders } from '../../hooks/useOrders'
import { useAllProducts } from '../../hooks/useProducts'
import { formatZAR } from '../../utils/formatCurrency'
import { lowStockItems } from '../../utils/salesReport'

export default function Dashboard() {
  const { data: orders, isError, refetch } = useOrders()
  const { data: products } = useAllProducts()

  useEffect(() => {
    document.title = 'Dashboard | 224 Admin'
  }, [])

  // COD business: money isn't collected until delivery, so revenue counts
  // 'delivered' orders only. Everything else non-cancelled is still owed.
  const deliveredRevenue = orders?.filter(o => o.status === 'delivered')
    .reduce((sum, o) => sum + o.total, 0) || 0
  const outstandingTotal = orders?.filter(o => o.status !== 'cancelled' && o.status !== 'delivered')
    .reduce((sum, o) => sum + o.total, 0) || 0
  const pendingOrders = orders?.filter(o => o.status === 'pending').length || 0
  const recentOrders = orders?.slice(0, 10) || []
  const lowStock = products ? lowStockItems(products) : []

  return (
    <AdminLayout>
      <div className="mb-8">
        <h1 className="font-heading text-3xl font-bold text-white">Dashboard</h1>
        <p className="text-muted text-sm mt-1">Welcome back to 224 Clubhouse admin.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        <StatsCard title="Total Products" value={products?.length ?? '—'} icon={Package} />
        <StatsCard title="Total Orders" value={orders?.length ?? '—'} icon={ShoppingCart} />
        <StatsCard
          title="Revenue (delivered)"
          value={orders ? formatZAR(deliveredRevenue) : '—'}
          icon={DollarSign}
          trend={orders ? `Outstanding (undelivered): ${formatZAR(outstandingTotal)}` : undefined}
        />
        <StatsCard title="Pending Orders" value={pendingOrders} icon={Clock} />
      </div>

      {/* Low stock (on-sale products or variants with 5 or fewer left) */}
      {lowStock.length > 0 && (
        <div className="bg-surface border border-border rounded-xl p-4 sm:p-6 mb-8">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="font-heading text-lg font-semibold text-white">Low stock</h2>
            <Link
              to="/admin/reports"
              className="focus-ring h-11 inline-flex items-center text-xs uppercase tracking-widest text-gold underline underline-offset-2 rounded-lg"
            >
              Sales reports
            </Link>
          </div>
          <ul className="divide-y divide-border/50">
            {lowStock.slice(0, 8).map(i => (
              <li key={i.key} className="flex items-center justify-between gap-3 text-sm">
                <Link to="/admin/products" className="focus-ring min-h-11 inline-flex items-center text-white hover:text-gold min-w-0 rounded-lg">
                  {i.name}
                </Link>
                <span className={`tabular-nums whitespace-nowrap ${i.stock === 0 ? 'text-red-400' : 'text-yellow-400'}`}>
                  {i.stock === 0 ? 'Out of stock' : `${i.stock} left`}
                </span>
              </li>
            ))}
          </ul>
          {lowStock.length > 8 && (
            <p className="text-muted text-xs mt-3">
              +{lowStock.length - 8} more on the{' '}
              <Link to="/admin/reports" className="text-gold underline underline-offset-2">reports page</Link>.
            </p>
          )}
        </div>
      )}

      {/* Recent Orders */}
      <div className="bg-surface border border-border rounded-xl p-6">
        <h2 className="font-heading text-lg font-semibold text-white mb-5">Recent Orders</h2>
        {isError ? (
          <div className="py-10 text-center">
            <AlertTriangle size={28} className="text-red-400 mx-auto mb-3" />
            <p className="text-white text-sm mb-5">
              Couldn't load orders. Please check your connection and try again.
            </p>
            <button onClick={() => refetch()} className="btn-gold text-sm">
              Retry
            </button>
          </div>
        ) : (
          <OrdersTable orders={recentOrders} mini />
        )}
      </div>
    </AdminLayout>
  )
}
