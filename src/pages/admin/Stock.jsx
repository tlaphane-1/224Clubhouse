import { useEffect } from 'react'
import { ClipboardList, AlertTriangle } from 'lucide-react'
import AdminLayout from '../../components/admin/AdminLayout'
import { useStockLog } from '../../hooks/useStock'
import { reasonLabel, stockDelta } from '../../utils/stocktake'
import { adminTitle } from '../../tenant'

// Admin → Stock: every stock change made at the counter (stock-take,
// deliveries, damage), newest first, so missing stock can be traced.
const when = (iso) => new Date(iso).toLocaleString('en-ZA', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
})

export default function AdminStock() {
  const { data: rows = [], isLoading, isError, refetch } = useStockLog(100)

  useEffect(() => {
    document.title = adminTitle('Stock')
  }, [])

  return (
    <AdminLayout>
      <div className="mb-8">
        <h1 className="font-heading text-3xl font-bold text-white">Stock</h1>
        <p className="text-muted text-sm mt-1">Changes made on the counter tablet (Stock tab). Latest 100.</p>
      </div>

      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-12"><div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" /></div>
        ) : isError ? (
          <div className="p-10 text-center">
            <AlertTriangle size={28} className="text-red-400 mx-auto mb-3" aria-hidden="true" />
            <p className="text-white text-sm mb-5">Couldn&apos;t load stock changes.</p>
            <button type="button" onClick={() => refetch()} className="btn-gold text-sm">Retry</button>
          </div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center">
            <ClipboardList size={28} className="text-muted mx-auto mb-3" aria-hidden="true" />
            <p className="text-white text-sm mb-1">No stock changes yet</p>
            <p className="text-muted text-xs">Staff count stock on the counter tablet&apos;s Stock tab.</p>
          </div>
        ) : (
          rows.map(r => {
            const delta = stockDelta(r.old_qty, r.new_qty)
            return (
              <div key={r.id} className="border-b border-border/50 last:border-0 px-4 sm:px-5 py-4 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-white text-sm font-medium">
                    {r.product_name}{r.variant_label ? <span className="text-muted"> · {r.variant_label}</span> : null}
                  </p>
                  <p className="text-muted text-xs mt-0.5">
                    {when(r.created_at)} · {r.who} · {reasonLabel(r.reason)}{r.note ? ` — ${r.note}` : ''}
                  </p>
                </div>
                <p className="text-sm shrink-0">
                  <span className="text-muted">{r.old_qty} → </span>
                  <span className="text-white font-semibold">{r.new_qty}</span>
                  <span className={`ml-2 ${delta.startsWith('−') ? 'text-red-400' : delta === '0' ? 'text-muted' : 'text-green-400'}`}>({delta})</span>
                </p>
              </div>
            )
          })
        )}
      </div>
    </AdminLayout>
  )
}
