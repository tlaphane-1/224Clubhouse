import ProductCard from './ProductCard'

function SkeletonCard() {
  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden animate-pulse">
      <div className="aspect-square bg-border" />
      <div className="p-4 space-y-2">
        <div className="h-3 bg-border rounded w-1/3" />
        <div className="h-4 bg-border rounded w-3/4" />
        <div className="h-3 bg-border rounded w-1/2" />
        <div className="flex justify-between mt-3">
          <div className="h-6 bg-border rounded w-20" />
          <div className="h-8 bg-border rounded w-16" />
        </div>
      </div>
    </div>
  )
}

export default function ProductGrid({ products, loading }) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
    )
  }

  if (!products || products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="font-heading text-6xl font-bold text-gold/20 mb-4">224</div>
        <h3 className="text-white font-semibold text-xl mb-2">No products found</h3>
        <p className="text-muted text-sm">Check back soon — new stock drops regularly.</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      {products.map(product => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  )
}
