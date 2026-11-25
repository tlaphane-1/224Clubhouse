import { useMemo, useState } from 'react'
import { Camera, Search } from 'lucide-react'
import toast from 'react-hot-toast'
import QrScanner from './QrScanner'
import { useProducts } from '../../hooks/useProducts'
import { useSetStock } from '../../hooks/useStock'
import { lineFromScan, parseLabelCode, productLine } from '../../utils/counter'
import { STOCK_REASONS, parseCount, stockDelta } from '../../utils/stocktake'
import { tenant } from '../../tenant'

// Stock-take at the counter: pick or scan a product (or option), type what is
// actually on the shelf, choose why it changed, save. Every save is logged.
export default function StockPanel({ onShift, onGoToShift }) {
  const { data: products, isLoading, isError, refetch } = useProducts()
  const setStock = useSetStock()
  const [query, setQuery] = useState('')
  const [scanning, setScanning] = useState(false)
  const [item, setItem] = useState(null) // a cart-style line: { productId, variantId, name, label, stock }
  const [count, setCount] = useState('')
  const [reason, setReason] = useState('count')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [last, setLast] = useState(null)

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const out = []
    for (const p of products ?? []) {
      if (q && !p.name.toLowerCase().includes(q)) continue
      const variants = p.product_variants ?? []
      if (variants.length === 0) out.push(productLine(p))
      else for (const v of variants) out.push(productLine(p, v))
    }
    return out.slice(0, 40)
  }, [products, query])

  const choose = (line) => {
    setItem(line)
    setCount('')
    setError('')
  }

  const onScan = (text) => {
    // Stock-take also counts options that are switched off, so look them up directly.
    const res = lineFromScan(products, parseLabelCode(text, tenant.domain.liveHosts))
    if (res.line) {
      choose(res.line)
      setScanning(false)
      return
    }
    const code = parseLabelCode(text, tenant.domain.liveHosts)
    const product = code && (products ?? []).find(p => p.slug === code.slug)
    const variant = product && code.variantId && (product.product_variants ?? []).find(v => v.id === code.variantId)
    if (variant) {
      choose(productLine(product, variant))
      setScanning(false)
      return
    }
    toast.error(res.error)
  }

  const save = async () => {
    const counted = parseCount(count)
    if (counted === null) {
      setError('Enter a whole number from 0 to 100000')
      return
    }
    setError('')
    try {
      const res = await setStock.mutateAsync({
        productId: item.productId, variantId: item.variantId, counted, reason, note,
        expectedOld: reason === 'received' ? null : item.stock,
      })
      const name = `${item.name}${item.label ? ` ${item.label}` : ''}`
      setLast(`${name}: ${res.old_qty} → ${res.new_qty} (${stockDelta(res.old_qty, res.new_qty)})`)
      toast.success('Stock saved')
      setItem(null)
      setCount('')
      setNote('')
      setReason('count')
    } catch (err) {
      const msg = err?.message || 'Could not save the count'
      // A sale changed the stock since it was shown: show the new number.
      const now = msg.match(/it is now (\d+)/)
      if (now) {
        setItem(it => (it ? { ...it, stock: Number(now[1]) } : it))
        refetch()
      }
      setError(msg)
      toast.error(msg)
    }
  }

  if (!onShift) {
    return (
      <section className="bg-surface border border-border rounded-2xl p-6 text-center">
        <p className="text-white font-semibold mb-2">Start your shift first</p>
        <p className="text-muted text-sm mb-4">Stock changes are recorded against the person on shift.</p>
        <button type="button" onClick={onGoToShift} className="btn-gold min-h-11 px-6">Go to shift</button>
      </section>
    )
  }

  const label = 'block text-muted text-xs uppercase tracking-widest mb-1.5'
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <section className="bg-surface border border-border rounded-2xl p-6 space-y-4" aria-labelledby="stock-pick">
        <h2 id="stock-pick" className="text-gold text-xs uppercase tracking-widest">Product</h2>
        {scanning ? (
          <QrScanner onCode={onScan} onClose={() => setScanning(false)} />
        ) : (
          <button type="button" onClick={() => setScanning(true)}
            className="btn-outline w-full min-h-11 inline-flex items-center justify-center gap-2 text-xs uppercase tracking-widest">
            <Camera size={16} aria-hidden="true" /> Scan label
          </button>
        )}
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input className="input-base text-sm pl-9" placeholder="Search products" aria-label="Search products"
            value={query} onChange={e => setQuery(e.target.value)} autoComplete="off" />
        </div>
        {isLoading ? (
          <div className="h-24 skeleton rounded-xl" aria-busy="true" />
        ) : isError ? (
          <p className="text-red-400 text-sm">
            Couldn&apos;t load products.{' '}
            <button type="button" onClick={() => refetch()} className="underline min-h-11">Try again</button>
          </p>
        ) : rows.length === 0 ? (
          <p className="text-muted text-sm">No products match.</p>
        ) : (
          <ul className="max-h-80 overflow-y-auto divide-y divide-border border border-border rounded-xl">
            {rows.map(r => (
              <li key={r.key}>
                <button type="button" onClick={() => choose(r)}
                  className={`focus-ring w-full min-h-11 px-4 py-2 flex items-center justify-between gap-3 text-left hover:bg-background ${item?.key === r.key ? 'bg-background' : ''}`}>
                  <span className="text-white text-sm">{r.name}{r.label ? <span className="text-muted"> · {r.label}</span> : null}</span>
                  <span className="text-muted text-sm">{r.stock} in stock</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bg-surface border border-border rounded-2xl p-6 space-y-4" aria-labelledby="stock-count">
        <h2 id="stock-count" className="text-gold text-xs uppercase tracking-widest">Count</h2>
        {last && <p className="text-green-400 text-sm" role="status">Saved — {last}</p>}
        {!item ? (
          <p className="text-muted text-sm">Scan a label or pick a product to count it.</p>
        ) : (
          <>
            <p className="text-white font-semibold">
              {item.name}{item.label ? <span className="text-muted font-normal"> · {item.label}</span> : null}
            </p>
            <p className="text-muted text-sm">The system says {item.stock}.</p>
            <div>
              <label htmlFor="stock-reason" className={label}>Reason</label>
              <select id="stock-reason" className="input-base text-sm" value={reason} onChange={e => setReason(e.target.value)}>
                {STOCK_REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="stock-counted" className={label}>
                {reason === 'received' ? 'Quantity received *' : 'Counted on the shelf *'}
              </label>
              <input id="stock-counted" inputMode="numeric" pattern="[0-9]*" className="input-base text-sm"
                value={count} onChange={e => setCount(e.target.value)} autoComplete="off"
                aria-invalid={error ? true : undefined} aria-describedby={error ? 'stock-error' : 'stock-help'} />
              <p id="stock-help" className="text-muted text-xs mt-1">
                {reason === 'received'
                  ? `Added to the ${item.stock} already in stock.`
                  : 'The total on the shelf right now — this replaces the number above.'}
              </p>
            </div>
            <div>
              <label htmlFor="stock-note" className={label}>Note (optional)</label>
              <input id="stock-note" className="input-base text-sm" maxLength={200} value={note} onChange={e => setNote(e.target.value)} />
            </div>
            {error && <p id="stock-error" className="text-red-400 text-sm" role="alert">{error}</p>}
            <button type="button" onClick={save} disabled={setStock.isPending || count === ''} className="btn-gold w-full min-h-11">
              {setStock.isPending ? 'Saving…' : 'Save count'}
            </button>
          </>
        )}
      </section>
    </div>
  )
}
