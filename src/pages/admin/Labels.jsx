import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Printer, AlertTriangle, QrCode } from 'lucide-react'
import QRCode from 'qrcode'
import AdminLayout from '../../components/admin/AdminLayout'
import { useAllProducts } from '../../hooks/useProducts'
import { labelSheetItems } from '../../utils/counter'
import { formatZAR } from '../../utils/formatCurrency'
import { tenant, adminTitle } from '../../tenant'

// Admin → Products → Print QR labels. One label per product (or per option);
// the counter tablet scans them, and a customer's phone camera opens the
// product page. Prints on A4 label sheets, 3 × 8 (63.5 × 33.9 mm).

function useQrCodes(items) {
  const [codes, setCodes] = useState({})
  useEffect(() => {
    let active = true
    Promise.all(items.map(async i => [i.key, await QRCode.toDataURL(i.url, { margin: 1, width: 240 })]))
      .then(pairs => { if (active) setCodes(Object.fromEntries(pairs)) })
      .catch(() => { if (active) setCodes({}) })
    return () => { active = false }
  }, [items])
  return codes
}

export default function AdminLabels() {
  const { data: products, isLoading, isError, refetch } = useAllProducts()
  const items = useMemo(() => labelSheetItems(products ?? [], tenant.domain.siteUrl), [products])
  const codes = useQrCodes(items)

  useEffect(() => {
    document.title = adminTitle('QR labels')
  }, [])

  return (
    <AdminLayout>
      <style>{`
        @media print {
          @page { size: A4; margin: 13mm 7mm; }
          body * { visibility: hidden; }
          #label-sheet, #label-sheet * { visibility: visible; }
          #label-sheet { position: absolute; inset: 0; display: grid !important;
            grid-template-columns: repeat(3, 63.5mm); grid-auto-rows: 33.9mm; gap: 0 2.5mm; }
          .label { background: #fff !important; color: #000 !important; border: none !important; break-inside: avoid; }
        }
      `}</style>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-8 print:hidden">
        <div>
          <h1 className="font-heading text-3xl font-bold text-white">QR labels</h1>
          <p className="text-muted text-sm mt-1">
            Stick these on the jars. The counter tablet scans them. <Link to="/admin/products" className="text-gold underline underline-offset-2">Back to products</Link>
          </p>
        </div>
        <button type="button" onClick={() => window.print()} disabled={!items.length}
          className="btn-gold flex items-center gap-2 text-sm min-h-11">
          <Printer size={16} aria-hidden="true" /> Print
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" /></div>
      ) : isError ? (
        <div className="bg-surface border border-red-500/20 rounded-xl p-10 text-center">
          <AlertTriangle size={28} className="text-red-400 mx-auto mb-3" aria-hidden="true" />
          <p className="text-white text-sm mb-5">Couldn&apos;t load products.</p>
          <button type="button" onClick={() => refetch()} className="btn-gold text-sm">Retry</button>
        </div>
      ) : items.length === 0 ? (
        <div className="bg-surface border border-border rounded-xl p-8 text-center">
          <QrCode size={28} className="text-muted mx-auto mb-3" aria-hidden="true" />
          <p className="text-white text-sm">No products for sale yet.</p>
        </div>
      ) : (
        <div id="label-sheet" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map(i => (
            <div key={i.key} className="label bg-surface border border-border rounded-xl p-3 flex items-center gap-3">
              {codes[i.key]
                ? <img src={codes[i.key]} alt={`QR code for ${i.name}${i.option ? ` ${i.option}` : ''}`} className="w-24 h-24 shrink-0 bg-white rounded" />
                : <div className="w-24 h-24 shrink-0 skeleton rounded" aria-hidden="true" />}
              <div className="min-w-0">
                <p className="font-semibold text-sm leading-tight">{i.name}</p>
                {i.option && <p className="text-xs">{i.option}</p>}
                <p className="text-sm font-bold mt-1">{formatZAR(i.price)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </AdminLayout>
  )
}
