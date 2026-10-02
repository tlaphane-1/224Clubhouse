import Badge from '../ui/Badge'
import { formatZAR } from '../../utils/formatCurrency'
import { ALL_STATUSES, statusLabel } from '../../utils/orderStatus'

export default function OrdersTable({ orders, onStatusChange, mini = false }) {
  if (!orders || orders.length === 0) {
    return <p className="text-muted text-sm py-4">No orders yet.</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-muted uppercase tracking-widest text-xs">
            <th className="pb-3 text-left font-medium">Order ID</th>
            <th className="pb-3 text-left font-medium">Customer</th>
            {!mini && <th className="pb-3 text-left font-medium">Email</th>}
            <th className="pb-3 text-right font-medium">Total</th>
            <th className="pb-3 text-center font-medium">Status</th>
            <th className="pb-3 text-right font-medium">Date</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {orders.map(order => (
            <tr key={order.id} className="hover:bg-border/30 transition-colors">
              <td className="py-4 pr-4">
                <span className="font-mono text-gold text-xs">{order.order_number || `${order.id.slice(0, 8)}...`}</span>
              </td>
              <td className="py-4 pr-4">
                <span className="text-white">{order.customer_name}</span>
              </td>
              {!mini && (
                <td className="py-4 pr-4 text-muted">{order.customer_email}</td>
              )}
              <td className="py-4 pr-4 text-right text-white font-semibold">
                {formatZAR(order.total)}
              </td>
              <td className="py-4 px-4 text-center">
                {onStatusChange ? (
                  <select
                    value={order.status}
                    onChange={e => onStatusChange(order.id, e.target.value)}
                    className="bg-background border border-border text-white text-xs rounded px-2 py-1 cursor-pointer"
                  >
                    {ALL_STATUSES.map(s => (
                      <option key={s} value={s}>{statusLabel(s)}</option>
                    ))}
                  </select>
                ) : (
                  <Badge variant={order.status}>{statusLabel(order.status)}</Badge>
                )}
              </td>
              <td className="py-4 text-right text-muted text-xs">
                {new Date(order.created_at).toLocaleDateString('en-ZA')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
