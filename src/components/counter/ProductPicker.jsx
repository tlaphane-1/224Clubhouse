import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { useProducts } from '../../hooks/useProducts'
import { formatZAR } from '../../utils/formatCurrency'
import { productLine } from '../../utils/counter'

// Tap-to-add product list for the counter (alternative to scanning labels).
// Products with options show one button per option.
export default function ProductPicker({ onAdd }) {
  const { data: products, isLoading, isError, refetch } = useProducts()
  const [query, setQuery] = useState('')
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (products ?? []).filter(p => !q || p.name.toLowerCase().includes(q)).slice(0, 30)
  }, [products, query])

  return (
    <div className="space-y-3">
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
      ) : shown.length === 0 ? (
        <p className="text-muted text-sm">No products match.</p>
      ) : (
        <ul className="max-h-72 overflow-y-auto divide-y divide-border border border-border rounded-xl">
          {shown.map(p => {
            const variants = (p.product_variants ?? []).filter(v => v.is_available)
            return (
              <li key={p.id} className="px-4 py-2">
                {variants.length === 0 ? (
                  <button type="button" disabled={p.stock_quantity < 1} onClick={() => onAdd(productLine(p))}
                    className="focus-ring w-full min-h-11 flex items-center justify-between gap-3 text-left disabled:opacity-50">
                    <span className="text-white text-sm">{p.name}</span>
                    <span className="text-muted text-sm">{p.stock_quantity < 1 ? 'Sold out' : formatZAR(p.price)}</span>
                  </button>
                ) : (
                  <div>
                    <p className="text-white text-sm py-2">{p.name}</p>
                    <div className="flex flex-wrap gap-2 pb-2">
                      {variants.map(v => (
                        <button key={v.id} type="button" disabled={v.stock_quantity < 1} onClick={() => onAdd(productLine(p, v))}
                          className="focus-ring min-h-11 px-3 rounded-lg border border-border text-sm text-white hover:border-gold disabled:opacity-50">
                          {v.label} · {v.stock_quantity < 1 ? 'Sold out' : formatZAR(v.price)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
