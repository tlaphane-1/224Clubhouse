import { lineName } from '../../utils/variants'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronDown, ChevronRight, AlertTriangle, FileText } from 'lucide-react'
import AdminLayout from '../../components/admin/AdminLayout'
import Badge from '../../components/ui/Badge'
import { useOrders, useUpdateOrderStatus } from '../../hooks/useOrders'
import { formatZAR } from '../../utils/formatCurrency'
import { ALL_STATUSES, statusLabel, paymentLabel, eftState, EFT_GATED_STATUSES } from '../../utils/orderStatus'
import EftAdminPanel, { EftPill } from '../../components/admin/EftAdminPanel'
import DriverAssign from '../../components/admin/DriverAssign'
import { useDrivers } from '../../hooks/useDelivery'
import toast from 'react-hot-toast'

export default function Orders() {
  const { data: orders, isLoading, isError, refetch } = useOrders()
  const updateStatus = useUpdateOrderStatus()
  const { data: drivers } = useDrivers()
  const driverName = (id) => drivers?.find(d => d.user_id === id)?.full_name
  // ?filter=eft opens straight on the EFT payments to check (Dashboard link).
  const [searchParams] = useSearchParams()
  const [filter, setFilter] = useState(searchParams.get('filter') === 'eft' ? 'eft' : 'all')
  const [expandedId, setExpandedId] = useState(null)

  useEffect(() => {
    document.title = 'Orders | 224 Admin'
  }, [])

  // `selectEl` is the <select> that fired the change: a controlled select whose
  // state never changes (confirm declined) does not re-render, so the DOM would
  // keep showing the abandoned choice — put it back by hand.
  const handleStatusChange = async (order, status, selectEl) => {
    if (status === 'cancelled' && order.status !== 'cancelled') {
      const label = order.order_number || order.id.slice(0, 8)
      // Cancelling returns the order's units to stock — except from
      // "Delivered", where the goods have already left (see migration
      // 20260814101000_restock_on_cancel.sql).
      const stockLine =
        order.status === 'delivered'
          ? 'It is already marked Delivered, so stock will NOT be returned — adjust it by hand if the goods came back.'
          : 'The items will be returned to stock.'
      if (!window.confirm(`Cancel order ${label}? ${stockLine}`)) {
        if (selectEl) selectEl.value = order.status
        return
      }
    }
    try {
      await updateStatus.mutateAsync({
        orderId: order.id,
        status,
        // Carried through so the mutation can email the customer about the change.
        orderNumber: order.order_number,
        customerName: order.customer_name,
        customerEmail: order.customer_email,
      })
      toast.success(`Order status updated to "${statusLabel(status)}"`)
    } catch (err) {
      // The server refuses some moves (e.g. an unpaid EFT order to Preparing);
      // say why instead of a generic failure, and put the select back.
      toast.error(err?.message || 'Failed to update status')
      if (selectEl) selectEl.value = order.status
    }
  }

  const filtered = orders?.filter(o =>
    filter === 'all' ||
    (filter === 'eft' ? ['awaiting', 'proof'].includes(eftState(o)) : o.status === filter)
  ) || []
  const eftToCheck = orders?.filter(o => ['awaiting', 'proof'].includes(eftState(o))).length ?? 0

  return (
    <AdminLayout>
      <div className="mb-8">
        <h1 className="font-heading text-3xl font-bold text-white">Orders</h1>
        <p className="text-muted text-sm mt-1">{orders?.length || 0} total orders</p>
      </div>

      {/* Filter */}
      <div className="flex gap-2 flex-wrap mb-6">
        <button
          onClick={() => setFilter('eft')}
          className={`px-4 py-1.5 rounded-full text-xs font-medium uppercase tracking-wide transition-all border ${
            filter === 'eft'
              ? 'border-gold text-gold bg-gold/10'
              : 'border-border text-muted hover:border-muted hover:text-white'
          }`}
        >
          EFT to check{eftToCheck > 0 ? ` (${eftToCheck})` : ''}
        </button>
        {['all', ...ALL_STATUSES].map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-4 py-1.5 rounded-full text-xs font-medium uppercase tracking-wide transition-all border ${
              filter === s
                ? 'border-gold text-gold bg-gold/10'
                : 'border-border text-muted hover:border-muted hover:text-white'
            }`}
          >
            {s === 'all' ? 'all' : statusLabel(s)}
          </button>
        ))}
      </div>

      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-muted">Loading orders...</div>
        ) : isError ? (
          <div className="p-10 text-center">
            <AlertTriangle size={28} className="text-red-400 mx-auto mb-3" />
            <p className="text-white text-sm mb-5">
              Couldn't load orders. Please check your connection and try again.
            </p>
            <button onClick={() => refetch()} className="btn-gold text-sm">
              Retry
            </button>
          </div>
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
                {/* Mobile card */}
                <div className="md:hidden px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-white text-sm font-medium truncate">{order.customer_name}</p>
                      <p className="text-muted text-xs truncate">{order.customer_email}</p>
                      <p className="font-mono text-gold text-[11px] mt-1">
                        {order.order_number || `${order.id.slice(0, 8)}…`} · {new Date(order.created_at).toLocaleDateString('en-ZA')}
                      </p>
                      <p className="text-muted text-[11px] mt-0.5">{paymentLabel(order.payment_method)}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-white font-semibold text-sm">{formatZAR(order.total)}</p>
                      <div className="mt-1"><Badge variant={order.status}>{statusLabel(order.status)}</Badge></div>
                      <div className="mt-1"><EftPill order={order} /></div>
                      {order.driver_id && <p className="text-muted text-xs mt-1">🚚 {driverName(order.driver_id) ?? 'Driver'}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-3">
                    <select
                      value={order.status}
                      onChange={e => handleStatusChange(order, e.target.value, e.target)}
                      className="flex-1 bg-background border border-border text-white text-xs rounded px-2 py-2 cursor-pointer"
                    >
                      {ALL_STATUSES.map(s => {
                        const blocked = s !== order.status && order.payment_method === 'eft' && !order.paid_at && EFT_GATED_STATUSES.includes(s)
                        return <option key={s} value={s} disabled={blocked}>{statusLabel(s)}{blocked ? ' (needs EFT payment)' : ''}</option>
                      })}
                    </select>
                    <button
                      onClick={() => setExpandedId(id => id === order.id ? null : order.id)}
                      className="text-muted hover:text-white border border-border rounded p-2 flex-shrink-0"
                      aria-label="Toggle order details"
                    >
                      {expandedId === order.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                  </div>
                </div>

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
                  <div className="text-center space-y-1">
                    <Badge variant={order.status}>{statusLabel(order.status)}</Badge>
                    <div><EftPill order={order} /></div>
                    {order.driver_id && <p className="text-muted text-xs">🚚 {driverName(order.driver_id) ?? 'Driver'}</p>}
                  </div>
                  <div className="text-center">
                    <select
                      value={order.status}
                      onChange={e => handleStatusChange(order, e.target.value, e.target)}
                      className="bg-background border border-border text-white text-xs rounded px-2 py-1.5 cursor-pointer w-full"
                    >
                      {ALL_STATUSES.map(s => {
                        const blocked = s !== order.status && order.payment_method === 'eft' && !order.paid_at && EFT_GATED_STATUSES.includes(s)
                        return <option key={s} value={s} disabled={blocked}>{statusLabel(s)}{blocked ? ' (needs EFT payment)' : ''}</option>
                      })}
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
                          <p className="text-muted">Order #: <span className="text-white">{order.order_number || order.id.slice(0, 8)}</span></p>
                          <p className="text-muted">Payment: <span className="text-white">{paymentLabel(order.payment_method)}</span></p>
                          <p className="text-muted">Phone: <span className="text-white">{order.customer_phone}</span></p>
                          <a
                            href={`/orders/${order.id}/invoice`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 min-h-11 text-gold hover:text-gold-light text-xs uppercase tracking-widest"
                          >
                            <FileText size={14} />
                            Invoice
                          </a>
                          {order.paystack_reference && (
                            <p className="text-muted">Ref: <span className="font-mono text-gold text-xs">{order.paystack_reference}</span></p>
                          )}
                        </div>
                      </div>
                      <div>
                        <h4 className="text-gold text-xs uppercase tracking-widest mb-3">Items</h4>
                        <div className="space-y-2">
                          {order.items?.map((item, i) => (
                            <div key={i} className="flex justify-between text-sm">
                              <span className="text-white">{lineName(item)} <span className="text-muted">×{item.quantity}</span></span>
                              <span className="text-white">{formatZAR(item.price * item.quantity)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                    <EftAdminPanel order={order} />
                    <DriverAssign order={order} drivers={drivers} />
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
