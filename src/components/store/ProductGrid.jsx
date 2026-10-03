import ProductCard from './ProductCard'

// Two columns on phones (where most visitors shop), so a screen shows four
// products instead of one; widens to 3–4 on larger screens.
const GRID = 'grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-6'

function SkeletonCard() {
  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden" aria-hidden="true">
      <div className="aspect-portrait skeleton" />
      <div className="p-3 sm:p-4 space-y-2">
        <div className="h-3 skeleton rounded w-1/3" />
        <div className="h-4 skeleton rounded w-3/4" />
        <div className="flex items-center justify-between pt-2">
          <div className="h-5 skeleton rounded w-16" />
          <div className="h-11 w-11 sm:w-16 sm:h-8 skeleton rounded-full sm:rounded-lg" />
        </div>
      </div>
    </div>
  )
}

export default function ProductGrid({ products, loading, skeletonCount = 8 }) {
  if (loading) {
    return (
      <div className={GRID} role="status" aria-label="Loading products">
        {Array.from({ length: skeletonCount }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
    )
  }

  if (!products || products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="font-heading text-6xl font-bold text-gold/20 mb-4">224</div>
        <h3 className="text-white font-semibold text-xl mb-2">No products found</h3>
        <p className="text-muted text-sm">Check back soon — new stock drops regularly.</p>
      </div>
    )
  }

  return (
    <div className={GRID}>
      {products.map(product => (
        // The reveal wrapper is separate from the card so the scroll animation's
        // transform never fights the card's own press/hover transforms.
        <div key={product.id} className="reveal">
          <ProductCard product={product} />
        </div>
      ))}
    </div>
  )
}
