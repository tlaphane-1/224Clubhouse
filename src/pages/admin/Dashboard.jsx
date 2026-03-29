import { useEffect } from 'react'
import { Package, ShoppingCart, DollarSign, Clock } from 'lucide-react'
import AdminLayout from '../../components/admin/AdminLayout'
import StatsCard from '../../components/admin/StatsCard'
import OrdersTable from '../../components/admin/OrdersTable'
import { useOrders } from '../../hooks/useOrders'
import { useAllProducts } from '../../hooks/useProducts'
import { formatZAR } from '../../utils/formatCurrency'

export default function Dashboard() {
  const { data: orders } = useOrders()
  const { data: products } = useAllProducts()

  useEffect(() => {
    document.title = 'Dashboard | 224 Admin'
  }, [])

  const totalRevenue = orders?.filter(o => o.status !== 'cancelled')
    .reduce((sum, o) => sum + o.total, 0) || 0
  const pendingOrders = orders?.filter(o => o.status === 'pending').length || 0
  const recentOrders = orders?.slice(0, 10) || []

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
        <StatsCard title="Total Revenue" value={orders ? formatZAR(totalRevenue) : '—'} icon={DollarSign} />
        <StatsCard title="Pending Orders" value={pendingOrders} icon={Clock} />
      </div>

      {/* Recent Orders */}
      <div className="bg-surface border border-border rounded-xl p-6">
        <h2 className="font-heading text-lg font-semibold text-white mb-5">Recent Orders</h2>
        <OrdersTable orders={recentOrders} mini />
      </div>
    </AdminLayout>
  )
}
