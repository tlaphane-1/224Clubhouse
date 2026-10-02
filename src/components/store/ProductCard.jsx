import { ShoppingCart, Lock } from 'lucide-react'
import { Link } from 'react-router-dom'
import Badge from '../ui/Badge'
import { useCart } from '../../context/useCart'
import { useAuth } from '../../context/useAuth'
import { useMyMembership } from '../../hooks/useMyMembership'
import { memberPurchaseGate } from '../../utils/memberGate'
import { formatZAR } from '../../utils/formatCurrency'
import { toastAddedToCart } from '../../utils/cartToast'

// Phones: a 44px round icon button (thumb-sized, fits a half-width card).
// sm+: the roomier icon + label button, still 44px tall for touch tablets.
const ACTION_BASE = `focus-ring absolute bottom-3 right-3 sm:bottom-4 sm:right-4 flex items-center justify-center gap-1.5
                     w-11 h-11 rounded-full sm:w-auto sm:px-3 sm:rounded-lg
                     text-xs font-semibold uppercase tracking-wide transition-all duration-200 active:scale-90`

export default function ProductCard({ product }) {
  const { addItem } = useCart()
  const { user } = useAuth()
  const membership = useMyMembership()
  const isOutOfStock = product.stock_quantity === 0

  // Purchase gate only — browsing member-only products stays open. Locks once
  // the membership query settles (success OR failure — see memberGate: a failed
  // read fails closed) so nobody is handed an Add button that the server will
  // reject at the end of checkout. Still loading = normal control, so an active
  // member never sees a "join" flash.
  const memberLocked = memberPurchaseGate(user, membership).isLocked(product)

  const handleAddToCart = () => {
    if (isOutOfStock) return
    addItem(product, 1)
    toastAddedToCart(product.name, membership.effectiveStatus === 'active')
  }

  return (
    // The action button sits beside the link (not inside it — nested
    // interactive elements are invalid and garble screen-reader names), and is
    // positioned over the card's price row.
    <div className="group relative h-full transition-transform duration-200 active:scale-[0.98]">
      <Link
        to={`/store/${product.slug}`}
        aria-label={`${product.name}, ${formatZAR(product.price)}`}
        className="focus-ring flex flex-col h-full bg-surface border border-border rounded-xl overflow-hidden
                   transition-all duration-300 hover:border-gold hover:shadow-glow"
      >
        {/* Image */}
        <div className="relative aspect-portrait bg-background overflow-hidden">
          {product.images && product.images.length > 0 ? (
            <img
              src={product.images[0]}
              alt={product.name}
              loading="lazy"
              decoding="async"
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
              <span className="text-white font-semibold uppercase tracking-widest text-xs sm:text-sm">Out of Stock</span>
            </div>
          )}

          {/* Badges stack rather than sit in opposite corners, so they never
              collide on a half-width phone card. The dark backing keeps the
              translucent badges readable on light product photos. */}
          <div className="absolute top-2 left-2 sm:top-3 sm:left-3 flex flex-col items-start gap-1">
            <span className="rounded-full bg-black/70">
              <Badge variant={product.category}>{product.category}</Badge>
            </span>
            {product.is_member_only && (
              <span className="rounded-full bg-black/70">
                <Badge variant="members">Members</Badge>
              </span>
            )}
          </div>
        </div>

        {/* Info */}
        <div className="flex flex-col flex-1 p-3 sm:p-4">
          {/* Strain Info */}
          {product.category === 'flower' && product.strain_type && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-2">
              <Badge variant={product.strain_type}>{product.strain_type}</Badge>
              {product.thc_percentage && (
                <span className="text-muted text-xs">THC {product.thc_percentage}%</span>
              )}
            </div>
          )}

          <h3 className="text-white font-semibold text-sm leading-snug line-clamp-2 mb-1 group-hover:text-gold transition-colors">
            {product.name}
          </h3>

          {product.weight_grams && (
            <p className="text-muted text-xs">{product.weight_grams}g</p>
          )}

          {/* Price row — right padding leaves room for the action button */}
          <div className="flex items-center min-h-11 mt-auto pt-3 pr-12 sm:pr-24">
            <span className="text-gold font-bold text-base sm:text-lg leading-tight">{formatZAR(product.price)}</span>
          </div>
        </div>
      </Link>

      {memberLocked ? (
        <Link
          to="/membership"
          aria-label={`${product.name} is for members only — join to unlock`}
          className={`${ACTION_BASE} border border-gold/40 text-gold hover:bg-gold hover:text-black`}
        >
          <Lock size={16} />
          <span className="hidden sm:inline">Members</span>
        </Link>
      ) : (
        <button
          type="button"
          onClick={handleAddToCart}
          disabled={isOutOfStock}
          aria-label={isOutOfStock ? `${product.name} is out of stock` : `Add ${product.name} to cart`}
          className={`${ACTION_BASE} ${
            isOutOfStock
              ? 'text-muted cursor-not-allowed'
              : 'bg-gold/10 text-gold hover:bg-gold hover:text-black active:bg-gold active:text-black'
          }`}
        >
          <ShoppingCart size={16} />
          <span className="hidden sm:inline">Add</span>
        </button>
      )}
    </div>
  )
}
