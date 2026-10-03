import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search, AlertTriangle } from 'lucide-react'
import { useProducts } from '../hooks/useProducts'
import ProductGrid from '../components/store/ProductGrid'
import CategoryFilter from '../components/store/CategoryFilter'

export default function Store() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const category = searchParams.get('category') || 'all'

  const { data: products, isLoading, isError, refetch } = useProducts(category === 'all' ? null : category)

  const filtered = products?.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase())
  )

  useEffect(() => {
    document.title = 'The Store | 224 Clubhouse'
  }, [])

  const handleCategoryChange = (value) => {
    setSearch('')
    if (value === 'all') {
      setSearchParams({})
    } else {
      setSearchParams({ category: value })
    }
  }

  return (
    <div className="min-h-screen pt-24 md:pt-28 pb-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-5 md:mb-8 animate-fadeIn">
          <p className="text-gold text-xs uppercase tracking-[0.4em] mb-2">Shop</p>
          <h1 className="font-heading text-3xl sm:text-4xl md:text-5xl font-bold text-white mb-1 md:mb-2">The Store</h1>
          <p className="text-muted text-sm md:text-base">Members' selection, delivered to your door</p>
        </div>

        {/* Search */}
        <div className="relative max-w-md">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="search"
            inputMode="search"
            enterKeyHint="search"
            aria-label="Search products"
            className="input-base pl-11 text-sm"
            placeholder="Search products..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Categories — pinned under the navbar (h-16 / md:h-20) while scrolling,
          so a phone shopper can switch category without scrolling back up. */}
      <div className="sticky top-16 md:top-20 z-30 mt-3 mb-5 md:mb-8 bg-background/90 backdrop-blur-md border-b border-border">
        <div className="max-w-7xl mx-auto">
          <CategoryFilter active={category} onChange={handleCategoryChange} />
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Grid */}
        {isError ? (
          <div className="bg-surface border border-red-500/20 rounded-2xl p-8 text-center max-w-md mx-auto animate-fadeIn">
            <AlertTriangle size={28} className="text-red-400 mx-auto mb-3" />
            <p className="text-white text-sm mb-5">
              Couldn't load products. Please check your connection and try again.
            </p>
            <button onClick={() => refetch()} className="btn-gold text-sm">
              Retry
            </button>
          </div>
        ) : (
          <ProductGrid products={filtered} loading={isLoading} />
        )}
      </div>
    </div>
  )
}
