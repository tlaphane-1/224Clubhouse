import toast from 'react-hot-toast'
import { useTableRequests, useCloseTableRequest } from '../../hooks/useTable'
import { formatZAR } from '../../utils/formatCurrency'

// Orders sent from the table tablet in the last 30 minutes. "Load" puts the
// customer and items into the sale below; the cashier then takes payment.
const time = (iso) => new Date(iso).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })

export default function TableOrders({ onLoad }) {
  const { data = [], isError } = useTableRequests({ enabled: true })
  const close = useCloseTableRequest()

  if (isError || data.length === 0) return null

  const dismiss = async (id) => {
    try {
      await close.mutateAsync({ id, status: 'cancelled' })
    } catch (err) {
      toast.error(err.message || 'Could not dismiss')
    }
  }

  return (
    <section className="bg-surface border border-gold/30 rounded-2xl p-6 space-y-3" aria-labelledby="table-orders">
      <h2 id="table-orders" className="text-gold text-xs uppercase tracking-widest">Table orders ({data.length})</h2>
      <ul className="divide-y divide-border">
        {data.map(r => {
          const total = r.items.reduce((s, i) => s + i.price * i.quantity, 0)
          return (
            <li key={r.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-white text-sm font-semibold">{r.full_name || 'Customer'} · {time(r.created_at)}</p>
                <p className="text-muted text-xs">
                  {r.items.map(i => `${i.quantity}× ${i.name}${i.label ? ` ${i.label}` : ''}`).join(', ')} · {formatZAR(total)}
                </p>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => onLoad(r)} className="btn-gold min-h-11 px-4 text-xs uppercase tracking-widest">Load</button>
                <button type="button" onClick={() => dismiss(r.id)} disabled={close.isPending}
                  className="btn-outline min-h-11 px-4 text-xs uppercase tracking-widest">Dismiss</button>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
