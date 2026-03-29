import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import AdminLayout from '../../components/admin/AdminLayout'
import Badge from '../../components/ui/Badge'
import { useOrders, useUpdateOrderStatus } from '../../hooks/useOrders'
import { formatZAR } from '../../utils/formatCurrency'
import toast from 'react-hot-toast'

const STATUS_OPTIONS = ['pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled']

export default function Orders() {
  const { data: orders, isLoading } = useOrders()
  const updateStatus = useUpdateOrderStatus()
  const [filter, setFilter] = useState('all')
  const [expandedId, setExpandedId] = useState(null)

  useEffect(() => {
    document.title = 'Orders | 224 Admin'
  }, [])

  const handleStatusChange = async (orderId, status) => {
    try {
      await updateStatus.mutateAsync({ orderId, status })
      toast.success(`Order status updated to "${status}"`)
    } catch {
      toast.error('Failed to update status')
    }
  }

  const filtered = orders?.filter(o => filter === 'all' || o.status === filter) || []

  return (
    <AdminLayout>
      <div className="mb-8">
        <h1 className="font-heading text-3xl font-bold text-white">Orders</h1>
        <p className="text-muted text-sm mt-1">{orders?.length || 0} total orders</p>
      </div>

      {/* Filter */}
      <div className="flex gap-2 flex-wrap mb-6">
        {['all', ...STATUS_OPTIONS].map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-4 py-1.5 rounded-full text-xs font-medium uppercase tracking-wide transition-all border ${
              filter === s
                ? 'border-gold text-gold bg-gold/10'
                : 'border-border text-muted hover:border-muted hover:text-white'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-muted">Loading orders...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-muted">No orders found.</div>
        ) : (
          <div>
            {/* Table Header */}
            <div className="hidden md:grid grid-cols-[2fr_2fr_1fr_1fr_1.5fr_0.5fr] gap-4 px-6 py-3 border-b border-border text-muted uppercase tracking-widest text-xs font-medium">
              <span>Order</span>
              <span>Customer</span>
              <span className="text-right">Total</span>
              <span className="text-center">Status</span>
              <span className="text-center">Update Status</span>
              <span />
            </div>

            {/* Rows */}
            {filtered.map(order => (
              <div key={order.id} className="border-b border-border last:border-0">
                <div className="hidden md:grid grid-cols-[2fr_2fr_1fr_1fr_1.5fr_0.5fr] gap-4 px-6 py-4 items-center hover:bg-border/20 transition-colors">
                  <div>
                    <p className="font-mono text-gold text-xs">{order.id.slice(0, 8)}...</p>
                    <p className="text-muted text-xs mt-0.5">{new Date(order.created_at).toLocaleDateString('en-ZA')}</p>
                  </div>
                  <div>
                    <p className="text-white text-sm">{order.customer_name}</p>
                    <p className="text-muted text-xs">{order.customer_email}</p>
                  </div>
                  <div className="text-right text-white font-semibold text-sm">{formatZAR(order.total)}</div>
                  <div className="text-center">
                    <Badge variant={order.status}>{order.status}</Badge>
                  </div>
                  <div className="text-center">
                    <select
                      value={order.status}
                      onChange={e => handleStatusChange(order.id, e.target.value)}
                      className="bg-background border border-border text-white text-xs rounded px-2 py-1.5 cursor-pointer w-full"
                    >
                      {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="text-center">
                    <button
                      onClick={() => setExpandedId(id => id === order.id ? null : order.id)}
                      className="text-muted hover:text-white transition-colors"
                    >
                      {expandedId === order.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                  </div>
                </div>

                {/* Expanded Row */}
                {expandedId === order.id && (
                  <div className="px-6 pb-6 bg-background/50 border-t border-border">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-5">
                      <div>
                        <h4 className="text-gold text-xs uppercase tracking-widest mb-3">Shipping Address</h4>
                        <address className="text-white text-sm not-italic leading-relaxed">
                          {order.shipping_address?.street}<br />
                          {order.shipping_address?.apartment && <>{order.shipping_address.apartment}<br /></>}
                          {order.shipping_address?.city}, {order.shipping_address?.province}<br />
                          {order.shipping_address?.postalCode}
                        </address>
                        <div className="mt-3 space-y-1 text-sm">
                          <p className="text-muted">Phone: <span className="text-white">{order.customer_phone}</span></p>
                          <p className="text-muted">Ref: <span className="font-mono text-gold text-xs">{order.paystack_reference}</span></p>
                        </div>
                      </div>
                      <div>
                        <h4 className="text-gold text-xs uppercase tracking-widest mb-3">Items</h4>
                        <div className="space-y-2">
                          {order.items?.map((item, i) => (
                            <div key={i} className="flex justify-between text-sm">
                              <span className="text-white">{item.name} <span className="text-muted">×{item.quantity}</span></span>
                              <span className="text-white">{formatZAR(item.price * item.quantity)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  )
}
