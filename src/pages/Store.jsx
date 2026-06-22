import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search } from 'lucide-react'
import { useProducts } from '../hooks/useProducts'
import ProductGrid from '../components/store/ProductGrid'
import CategoryFilter from '../components/store/CategoryFilter'

export default function Store() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const category = searchParams.get('category') || 'all'

  const { data: products, isLoading } = useProducts(category === 'all' ? null : category)

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
    <div className="min-h-screen pt-28 pb-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div
          className="mb-12 animate-fadeIn"
        >
          <p className="text-gold text-xs uppercase tracking-[0.4em] mb-2">Shop</p>
          <h1 className="font-heading text-4xl md:text-5xl font-bold text-white mb-2">The Store</h1>
          <p className="text-muted">Members' Selection</p>
        </div>

        {/* Search + Filter */}
        <div className="space-y-6 mb-10">
          {/* Search */}
          <div className="relative max-w-md">
            <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
            <input
              className="input-base pl-11 text-sm"
              placeholder="Search products..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          {/* Categories */}
          <CategoryFilter active={category} onChange={handleCategoryChange} />
          <div className="h-px bg-border" />
        </div>

        {/* Grid */}
        <ProductGrid products={filtered} loading={isLoading} />
      </div>
    </div>
  )
}
