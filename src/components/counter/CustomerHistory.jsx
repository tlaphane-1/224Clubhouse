import { useCustomerHistory } from '../../hooks/useCounter'
import { formatZAR } from '../../utils/formatCurrency'
import { lineName } from '../../utils/variants'

// The customer's last 10 orders — what they bought and when — so the cashier
// can remind them ("same as last time?").
const day = (iso) => new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })

export default function CustomerHistory({ userId, phone }) {
  const { data, isLoading, isError, refetch } = useCustomerHistory({ userId, phone })

  return (
    <div>
      <h3 className="text-gold text-xs uppercase tracking-widest mb-2">Last orders</h3>
      {isLoading ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2].map(i => <div key={i} className="h-10 skeleton rounded-lg" />)}
        </div>
      ) : isError ? (
        <p className="text-red-400 text-sm">
          Couldn&apos;t load their orders.{' '}
          <button type="button" onClick={() => refetch()} className="underline min-h-11">Try again</button>
        </p>
      ) : data.length === 0 ? (
        <p className="text-muted text-sm">No orders yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {data.map(o => (
            <li key={o.order_number} className="py-2 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-white">{day(o.created_at)}{o.channel === 'counter' ? ' · in store' : ' · online'}</span>
                <span className="text-white font-semibold">{formatZAR(o.total)}</span>
              </div>
              <p className="text-muted text-xs mt-0.5">
                {(o.items ?? []).map(i => `${i.quantity}× ${lineName(i)}`).join(', ')}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
