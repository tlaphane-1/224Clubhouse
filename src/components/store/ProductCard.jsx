import { ShoppingCart } from 'lucide-react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import Badge from '../ui/Badge'
import { useCart } from '../../context/CartContext'
import { formatZAR } from '../../utils/formatCurrency'

const IMAGE_PLACEHOLDER = null

export default function ProductCard({ product }) {
  const { addItem } = useCart()
  const isOutOfStock = product.stock_quantity === 0

  const handleAddToCart = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (isOutOfStock) return
    addItem(product, 1)
    toast.success(`${product.name} added to cart`, {
      style: { background: '#111111', color: '#fff', border: '1px solid #222222' },
      iconTheme: { primary: '#C9A84C', secondary: '#000' },
    })
  }

  return (
    <div className="group transition-transform duration-200 hover:scale-[1.02]">
      <Link to={`/store/${product.slug}`} className="block">
        <div className="bg-surface border border-border rounded-xl overflow-hidden
                        transition-all duration-300 group-hover:border-gold group-hover:shadow-lg group-hover:shadow-gold/10">
          {/* Image */}
          <div className="relative aspect-square bg-background overflow-hidden">
            {product.images && product.images.length > 0 ? (
              <img
                src={product.images[0]}
                alt={product.name}
                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <span className="font-heading text-4xl font-bold text-gold/30">224</span>
              </div>
            )}

            {/* Out of Stock Overlay */}
            {isOutOfStock && (
              <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
                <span className="text-white font-semibold uppercase tracking-widest text-sm">Out of Stock</span>
              </div>
            )}

            {/* Category Badge */}
            <div className="absolute top-3 left-3">
              <Badge variant={product.category}>{product.category}</Badge>
            </div>

            {product.is_member_only && (
              <div className="absolute top-3 right-3">
                <Badge variant="members">Members</Badge>
              </div>
            )}
          </div>

          {/* Info */}
          <div className="p-4">
            {/* Strain Info */}
            {product.category === 'flower' && product.strain_type && (
              <div className="flex items-center gap-2 mb-2">
                <Badge variant={product.strain_type}>{product.strain_type}</Badge>
                {product.thc_percentage && (
                  <span className="text-muted text-xs">THC {product.thc_percentage}%</span>
                )}
              </div>
            )}

            <h3 className="text-white font-semibold text-sm leading-tight mb-1 group-hover:text-gold transition-colors">
              {product.name}
            </h3>

            {product.weight_grams && (
              <p className="text-muted text-xs mb-2">{product.weight_grams}g</p>
            )}

            <div className="flex items-center justify-between mt-3">
              <span className="text-gold font-bold text-lg">{formatZAR(product.price)}</span>

              <button
                onClick={handleAddToCart}
                disabled={isOutOfStock}
                className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide px-3 py-2 rounded-lg
                            transition-all duration-200 ${
                              isOutOfStock
                                ? 'text-muted cursor-not-allowed'
                                : 'bg-gold/10 text-gold hover:bg-gold hover:text-black'
                            }`}
              >
                <ShoppingCart size={14} />
                Add
              </button>
            </div>
          </div>
        </div>
      </Link>
    </div>
  )
}
