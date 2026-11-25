import { useReducer, useState } from 'react'
import { Camera, Minus, Plus } from 'lucide-react'
import toast from 'react-hot-toast'
import CustomerPicker from './CustomerPicker'
import ProductPicker from './ProductPicker'
import QrScanner from './QrScanner'
import { useProducts } from '../../hooks/useProducts'
import { useRecordSale } from '../../hooks/useCounter'
import { counterCartReducer, cartTotal, toSaleItems, parseLabelCode, saleBlockers, productLine } from '../../utils/counter'
import { formatZAR } from '../../utils/formatCurrency'
import { PAYMENT_LABELS } from '../../utils/orderStatus'
import { tenant } from '../../tenant'

const METHODS = ['cash_on_delivery', 'card_on_delivery']

// Ring up an in-store sale: customer (+ their last orders), items (scan or
// tap), cash/card, ID check, complete. The server re-prices and checks stock.
export default function SalePanel({ onShift, onGoToShift }) {
  const [customer, setCustomer] = useState(null)
  const [cart, dispatch] = useReducer(counterCartReducer, { lines: [] })
  const [method, setMethod] = useState(null)
  const [idChecked, setIdChecked] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState('')
  const { data: products } = useProducts()
  const record = useRecordSale()

  const total = cartTotal(cart.lines)
  const blockers = saleBlockers({ customer, lines: cart.lines, method, idChecked, onShift })

  const addLine = (line) => {
    if (line.stock < 1) {
      toast.error(`${line.name}${line.label ? ` ${line.label}` : ''} is sold out`)
      return
    }
    dispatch({ type: 'add', line })
  }

  const onScan = (text) => {
    const code = parseLabelCode(text, tenant.domain.liveHosts)
    const product = code && (products ?? []).find(p => p.slug === code.slug)
    if (!product) {
      toast.error('Not one of our labels')
      return
    }
    const variants = product.product_variants ?? []
    const variant = code.variantId ? variants.find(v => v.id === code.variantId) : null
    if (variants.length > 0 && !variant) {
      toast.error(`Scan the option label for ${product.name}`)
      return
    }
    addLine(productLine(product, variant))
    toast.success(`Added ${product.name}${variant ? ` ${variant.label}` : ''}`)
  }

  const reset = () => {
    setCustomer(null)
    dispatch({ type: 'clear' })
    setMethod(null)
    setIdChecked(false)
    setError('')
  }

  const complete = async () => {
    setError('')
    try {
      const res = await record.mutateAsync({ customer, items: toSaleItems(cart.lines), method, idChecked })
      toast.success(`Sale ${res.order_number} saved — ${formatZAR(res.total)}`)
      reset()
    } catch (err) {
      const msg = err?.message || 'Could not save the sale'
      setError(msg)
      toast.error(msg)
    }
  }

  if (!onShift) {
    return (
      <section className="bg-surface border border-border rounded-2xl p-6 text-center">
        <p className="text-white font-semibold mb-2">Start your shift first</p>
        <p className="text-muted text-sm mb-4">Sales are recorded against the person on shift.</p>
        <button type="button" onClick={onGoToShift} className="btn-gold min-h-11 px-6">Go to shift</button>
      </section>
    )
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <section className="bg-surface border border-border rounded-2xl p-6" aria-labelledby="sale-customer">
        <h2 id="sale-customer" className="text-gold text-xs uppercase tracking-widest mb-4">Customer</h2>
        <CustomerPicker customer={customer} onChange={setCustomer} />
      </section>

      <section className="bg-surface border border-border rounded-2xl p-6 space-y-5" aria-labelledby="sale-items">
        <h2 id="sale-items" className="text-gold text-xs uppercase tracking-widest">Items</h2>

        {scanning ? (
          <QrScanner onCode={onScan} onClose={() => setScanning(false)} />
        ) : (
          <button type="button" onClick={() => setScanning(true)}
            className="btn-outline w-full min-h-11 inline-flex items-center justify-center gap-2 text-xs uppercase tracking-widest">
            <Camera size={16} aria-hidden="true" /> Scan label
          </button>
        )}
        <ProductPicker onAdd={addLine} />

        {cart.lines.length > 0 && (
          <ul className="divide-y divide-border">
            {cart.lines.map(l => (
              <li key={l.key} className="py-2 flex items-center justify-between gap-3">
                <span className="min-w-0 text-sm text-white">
                  {l.name}{l.label ? <span className="text-muted"> · {l.label}</span> : null}
                </span>
                <span className="flex items-center gap-1 shrink-0">
                  <button type="button" aria-label={`One less ${l.name}`} onClick={() => dispatch({ type: 'setQty', key: l.key, quantity: l.quantity - 1 })}
                    className="focus-ring w-11 h-11 rounded-lg border border-border text-white inline-flex items-center justify-center"><Minus size={14} aria-hidden="true" /></button>
                  <span className="w-8 text-center text-white text-sm" aria-live="polite">{l.quantity}</span>
                  <button type="button" aria-label={`One more ${l.name}`} disabled={l.quantity >= l.stock} onClick={() => dispatch({ type: 'setQty', key: l.key, quantity: l.quantity + 1 })}
                    className="focus-ring w-11 h-11 rounded-lg border border-border text-white inline-flex items-center justify-center disabled:opacity-40"><Plus size={14} aria-hidden="true" /></button>
                  <span className="w-20 text-right text-white text-sm">{formatZAR(l.price * l.quantity)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="flex justify-between pt-3 border-t border-border">
          <span className="text-white font-semibold">Total</span>
          <span className="text-gold font-bold text-lg">{formatZAR(total)}</span>
        </div>

        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Payment">
          {METHODS.map(m => (
            <button key={m} type="button" role="radio" aria-checked={method === m} onClick={() => setMethod(m)}
              className={`focus-ring min-h-11 rounded-xl border text-sm ${method === m ? 'border-gold ring-1 ring-gold text-white' : 'border-border text-muted hover:text-white'}`}>
              {PAYMENT_LABELS[m]}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-3 min-h-11 text-sm text-white cursor-pointer">
          <input type="checkbox" checked={idChecked} onChange={e => setIdChecked(e.target.checked)} className="w-5 h-5 accent-gold" />
          ID checked — {tenant.minimumAge} or older
        </label>

        {error && <p className="text-red-400 text-sm" role="alert">{error}</p>}
        {blockers.length > 0 && cart.lines.length > 0 && (
          <p className="text-muted text-xs">{blockers[0]}</p>
        )}
        <button type="button" onClick={complete} disabled={blockers.length > 0 || record.isPending} className="btn-gold w-full min-h-11">
          {record.isPending ? 'Saving…' : `Complete sale — ${formatZAR(total)}`}
        </button>
      </section>
    </div>
  )
}
