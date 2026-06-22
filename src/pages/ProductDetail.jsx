import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ShoppingCart, ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react'
import { useProduct, useProducts } from '../hooks/useProducts'
import { useCart } from '../context/CartContext'
import Badge from '../components/ui/Badge'
import ProductCard from '../components/store/ProductCard'
import { formatZAR } from '../utils/formatCurrency'
import toast from 'react-hot-toast'

export default function ProductDetail() {
  const { slug } = useParams()
  const { data: product, isLoading, error } = useProduct(slug)
  const { data: allProducts } = useProducts(product?.category)
  const { addItem } = useCart()
  const [quantity, setQuantity] = useState(1)
  const [imageIndex, setImageIndex] = useState(0)

  useEffect(() => {
    if (product) document.title = `${product.name} | 224 Clubhouse`
  }, [product])

  if (isLoading) {
    return (
      <div className="min-h-screen pt-28 flex items-center justify-center">
        <div className="text-muted animate-pulse">Loading...</div>
      </div>
    )
  }

  if (error || !product) {
    return (
      <div className="min-h-screen pt-28 flex flex-col items-center justify-center">
        <h2 className="font-heading text-2xl text-white mb-4">Product not found</h2>
        <Link to="/store" className="text-gold hover:text-gold-light flex items-center gap-2">
          <ArrowLeft size={16} /> Back to Store
        </Link>
      </div>
    )
  }

  const images = product.images?.length ? product.images : null
  const related = allProducts?.filter(p => p.id !== product.id).slice(0, 4)

  const handleAddToCart = () => {
    addItem(product, quantity)
    toast.success(`${product.name} added to cart`, {
      style: { background: '#111111', color: '#fff', border: '1px solid #222222' },
      iconTheme: { primary: '#C9A84C', secondary: '#000' },
    })
  }

  return (
    <div
      className="min-h-screen pt-28 pb-20 animate-fadeIn"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Breadcrumb */}
        <Link to="/store" className="flex items-center gap-2 text-muted hover:text-gold text-sm mb-8 transition-colors">
          <ArrowLeft size={16} /> Back to Store
        </Link>

        {/* Product Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 mb-20">
          {/* Images */}
          <div>
            <div className="relative aspect-square bg-surface border border-border rounded-2xl overflow-hidden mb-3">
              {images ? (
                <>
                  <img
                    src={images[imageIndex]}
                    alt={product.name}
                    className="w-full h-full object-cover"
                  />
                  {images.length > 1 && (
                    <>
                      <button
                        onClick={() => setImageIndex(i => (i - 1 + images.length) % images.length)}
                        className="absolute left-3 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/80 text-white p-3 sm:p-2 rounded-full transition-colors"
                      >
                        <ChevronLeft size={18} />
                      </button>
                      <button
                        onClick={() => setImageIndex(i => (i + 1) % images.length)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/80 text-white p-3 sm:p-2 rounded-full transition-colors"
                      >
                        <ChevronRight size={18} />
                      </button>
                    </>
                  )}
                </>
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <span className="font-heading text-7xl font-bold text-gold/20">224</span>
                </div>
              )}
            </div>

            {/* Thumbnails */}
            {images && images.length > 1 && (
              <div className="flex gap-2">
                {images.map((img, i) => (
                  <button
                    key={i}
                    onClick={() => setImageIndex(i)}
                    className={`w-16 h-16 rounded-lg overflow-hidden border-2 transition-colors ${
                      i === imageIndex ? 'border-gold' : 'border-border hover:border-muted'
                    }`}
                  >
                    <img src={img} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Info */}
          <div>
            <div className="flex flex-wrap gap-2 mb-4">
              <Badge variant={product.category}>{product.category}</Badge>
              {product.category === 'flower' && product.strain_type && (
                <Badge variant={product.strain_type}>{product.strain_type}</Badge>
              )}
              {product.is_member_only && <Badge variant="members">Members Only</Badge>}
            </div>

            <h1 className="font-heading text-3xl md:text-4xl font-bold text-white mb-2">
              {product.name}
            </h1>

            {product.category === 'flower' && (
              <div className="flex gap-4 mb-4 text-sm text-muted">
                {product.thc_percentage && <span>THC: <span className="text-white">{product.thc_percentage}%</span></span>}
                {product.weight_grams && <span>Weight: <span className="text-white">{product.weight_grams}g</span></span>}
              </div>
            )}

            <div className="text-gold font-bold text-4xl mb-6">{formatZAR(product.price)}</div>

            {product.description && (
              <p className="text-muted leading-relaxed mb-8 text-sm">{product.description}</p>
            )}

            {product.stock_quantity > 0 ? (
              <>
                {/* Quantity */}
                <div className="flex items-center gap-4 mb-6">
                  <span className="text-muted text-sm uppercase tracking-widest">Quantity</span>
                  <div className="flex items-center gap-3 border border-border rounded-lg p-1">
                    <button
                      onClick={() => setQuantity(q => Math.max(1, q - 1))}
                      className="w-8 h-8 flex items-center justify-center text-muted hover:text-white transition-colors"
                    >
                      −
                    </button>
                    <span className="text-white font-semibold w-8 text-center">{quantity}</span>
                    <button
                      onClick={() => setQuantity(q => Math.min(product.stock_quantity, q + 1))}
                      className="w-8 h-8 flex items-center justify-center text-muted hover:text-white transition-colors"
                    >
                      +
                    </button>
                  </div>
                  <span className="text-muted text-xs">{product.stock_quantity} in stock</span>
                </div>

                <button onClick={handleAddToCart} className="btn-gold w-full py-4 flex items-center justify-center gap-3">
                  <ShoppingCart size={18} />
                  Add to Cart — {formatZAR(product.price * quantity)}
                </button>
              </>
            ) : (
              <div className="btn-outline w-full py-4 text-center opacity-50 cursor-not-allowed">Out of Stock</div>
            )}
          </div>
        </div>

        {/* Related Products */}
        {related && related.length > 0 && (
          <div>
            <h2 className="section-heading text-white mb-8">You Might Also Like</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {related.map(p => <ProductCard key={p.id} product={p} />)}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
