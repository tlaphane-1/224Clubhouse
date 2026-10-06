import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ShoppingCart, ArrowLeft, ChevronLeft, ChevronRight, Lock, Truck } from 'lucide-react'
import { useProduct, useProducts } from '../hooks/useProducts'
import { useCart } from '../context/useCart'
import { useAuth } from '../context/useAuth'
import { useMyMembership } from '../hooks/useMyMembership'
import { memberPurchaseGate } from '../utils/memberGate'
import Badge from '../components/ui/Badge'
import ProductCard from '../components/store/ProductCard'
import ProductReviews from '../components/store/ProductReviews'
import StickyActionBar from '../components/ui/StickyActionBar'
import { formatZAR } from '../utils/formatCurrency'
import { SHIPPING_FEE } from '../utils/shipping'
import { toastAddedToCart } from '../utils/cartToast'
import BrandLogo from '../components/ui/BrandLogo'
import { purchasableVariants, hasVariants, toCartItem } from '../utils/variants'

export default function ProductDetail() {
  const { slug } = useParams()
  const { data: product, isLoading, error } = useProduct(slug)
  const { data: allProducts } = useProducts(product?.category)
  const { addItem } = useCart()
  const { user } = useAuth()
  const membership = useMyMembership()
  const [quantity, setQuantity] = useState(1)
  const [imageIndex, setImageIndex] = useState(0)
  // The shopper's pick; null = the default option (first one in stock).
  const [chosenVariantId, setChosenVariantId] = useState(null)

  useEffect(() => {
    if (product) document.title = `${product.name} | 224 Clubhouse`
  }, [product])

  if (isLoading) {
    return (
      <div className="min-h-screen pt-24 md:pt-28 pb-20" role="status" aria-label="Loading product">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="h-4 w-28 skeleton rounded mb-6 md:mb-8" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-12">
            <div className="aspect-square skeleton rounded-2xl" />
            <div className="space-y-4">
              <div className="h-6 w-24 skeleton rounded-full" />
              <div className="h-8 w-3/4 skeleton rounded" />
              <div className="h-10 w-1/3 skeleton rounded" />
              <div className="h-20 w-full skeleton rounded" />
            </div>
          </div>
        </div>
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

  // Purchase gate only — the page itself always renders. Locks once the
  // membership query settles (success OR failure — see memberGate: a failed
  // read fails closed) so nobody is handed an Add button that the server will
  // reject at the end of checkout. Still loading = normal control, so an active
  // member never sees a "join" flash.
  const memberLocked = memberPurchaseGate(user, membership).isLocked(product)

  // Options: price and stock follow the chosen option. A product whose every
  // option is switched off reads as unavailable (the server would reject a
  // plain line for it — see hasVariants).
  const withOptions = hasVariants(product)
  const options = purchasableVariants(product)
  const variant = withOptions
    ? (options.find(v => v.id === chosenVariantId)
        ?? options.find(v => v.stock_quantity > 0)
        ?? options[0]
        ?? null)
    : null
  const unitPrice = variant ? variant.price : product.price
  const stock = withOptions ? (variant?.stock_quantity ?? 0) : product.stock_quantity

  const chooseVariant = (id) => {
    setChosenVariantId(id)
    setQuantity(1) // the old quantity may exceed the new option's stock
  }

  const handleAddToCart = () => {
    addItem(toCartItem(product, variant), quantity)
    toastAddedToCart(variant ? `${product.name} — ${variant.label}` : product.name, membership.effectiveStatus === 'active')
  }

  const isMember = membership.effectiveStatus === 'active'
  const inStock = stock > 0

  // One purchase control, rendered in two places: inline from md up, and in a
  // bar pinned to the bottom of the screen on phones (within thumb reach, and
  // visible without scrolling past the photo). Each copy is display:none at the
  // other breakpoint, so only one is ever on screen or in the accessibility tree.
  const purchaseAction = memberLocked ? (
    <Link to="/membership" className="btn-gold w-full py-4 flex items-center justify-center gap-3">
      <Lock size={16} />
      Join to unlock
    </Link>
  ) : inStock ? (
    <button type="button" onClick={handleAddToCart} className="btn-gold w-full py-4 flex items-center justify-center gap-3">
      <ShoppingCart size={18} />
      Add to Cart — {formatZAR(unitPrice * quantity)}
    </button>
  ) : (
    <div className="btn-outline w-full py-4 text-center opacity-50 cursor-not-allowed">Out of Stock</div>
  )

  return (
    // No transform on this wrapper: it is the sticky bar's containing block.
    <div className="min-h-screen pt-24 md:pt-28 md:pb-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 animate-fadeIn">
        {/* Breadcrumb */}
        <Link to="/store" className="focus-ring rounded-lg inline-flex items-center gap-2 text-muted hover:text-gold text-sm py-3 -my-1 mb-2 md:mb-5 transition-colors">
          <ArrowLeft size={16} /> Back to Store
        </Link>

        {/* Product Layout */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-12 md:mb-20">
          {/* Images */}
          <div>
            <div className="relative mb-3">
              {/* Soft gold/leaf light behind the photo */}
              <div className="absolute -inset-2 hero-aura blur-2xl opacity-80" aria-hidden="true" />
              <div className="relative aspect-square bg-surface border border-border rounded-2xl overflow-hidden shadow-glow">
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
                          type="button"
                          aria-label="Previous image"
                          onClick={() => setImageIndex(i => (i - 1 + images.length) % images.length)}
                          className="focus-ring absolute left-2 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center bg-black/50 hover:bg-black/80 active:bg-black/80 text-white rounded-full transition-colors"
                        >
                          <ChevronLeft size={20} />
                        </button>
                        <button
                          type="button"
                          aria-label="Next image"
                          onClick={() => setImageIndex(i => (i + 1) % images.length)}
                          className="focus-ring absolute right-2 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center bg-black/50 hover:bg-black/80 active:bg-black/80 text-white rounded-full transition-colors"
                        >
                          <ChevronRight size={20} />
                        </button>
                      </>
                    )}
                  </>
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <BrandLogo decorative className="w-1/2 opacity-20" />
                  </div>
                )}
              </div>
            </div>

            {/* Thumbnails */}
            {images && images.length > 1 && (
              <div className="flex gap-2 overflow-x-auto scrollbar-hide">
                {images.map((img, i) => (
                  <button
                    key={i}
                    type="button"
                    aria-label={`Show image ${i + 1}`}
                    aria-pressed={i === imageIndex}
                    onClick={() => setImageIndex(i)}
                    className={`focus-ring flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 transition-colors ${
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
            <div className="flex flex-wrap gap-2 mb-3 md:mb-4">
              <Badge variant={product.category}>{product.category}</Badge>
              {product.category === 'flower' && product.strain_type && (
                <Badge variant={product.strain_type}>{product.strain_type}</Badge>
              )}
              {product.is_member_only && <Badge variant="members">Members Only</Badge>}
            </div>

            <h1 className="font-heading text-2xl sm:text-3xl md:text-4xl font-bold text-white leading-tight mb-2">
              {product.name}
            </h1>

            {product.category === 'flower' && (
              <div className="flex gap-4 mb-3 text-sm text-muted">
                {product.thc_percentage && <span>THC: <span className="text-white">{product.thc_percentage}%</span></span>}
                {product.weight_grams && <span>Weight: <span className="text-white">{product.weight_grams}g</span></span>}
              </div>
            )}

            <div className="text-gold font-bold text-3xl md:text-4xl mb-3">{formatZAR(unitPrice)}</div>

            {/* Delivery note — the membership nudge where it matters most */}
            <p className="flex items-start gap-2 text-sm mb-6">
              <Truck size={16} className="text-leaf mt-0.5 shrink-0" />
              {isMember ? (
                <span className="text-white">Free delivery, your member benefit</span>
              ) : (
                <span className="text-muted">
                  Delivery {formatZAR(SHIPPING_FEE)} ·{' '}
                  <Link to="/membership" className="focus-ring rounded inline-block py-3 -my-3 text-leaf underline underline-offset-2">free for members</Link>
                </span>
              )}
            </p>

            {product.description && (
              <p className="text-muted leading-relaxed mb-6 md:mb-8 text-sm">{product.description}</p>
            )}

            {memberLocked && (
              <div className="border border-gold/40 bg-gold/5 rounded-xl p-5 mb-4 flex items-start gap-3">
                <Lock size={18} className="text-gold mt-0.5 shrink-0" />
                <div>
                  <p className="text-white font-semibold text-sm mb-1">Members only</p>
                  <p className="text-muted text-sm leading-relaxed">
                    This product is reserved for active 224 Clubhouse members.
                  </p>
                </div>
              </div>
            )}

            {withOptions && options.length > 0 && (
              <fieldset className="mb-5">
                <legend className="text-muted text-xs uppercase tracking-widest mb-2">Choose an option</legend>
                <div className="flex flex-wrap gap-2">
                  {options.map(v => {
                    const selected = v.id === variant?.id
                    const soldOut = v.stock_quantity < 1
                    return (
                      <label
                        key={v.id}
                        className={`chip whitespace-normal h-auto min-h-11 py-2 text-left max-w-full cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-gold
                                    has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background
                                    ${selected ? 'chip-active' : 'chip-idle'} ${soldOut ? 'opacity-50' : ''}`}
                      >
                        <input
                          type="radio"
                          name="product-option"
                          value={v.id}
                          checked={selected}
                          onChange={() => chooseVariant(v.id)}
                          className="sr-only"
                        />
                        <span>{v.label}</span>
                        <span className={selected ? 'text-black/70' : 'text-gold'}>{formatZAR(v.price)}</span>
                        {soldOut && <span className="text-xs">· sold out</span>}
                      </label>
                    )
                  })}
                </div>
              </fieldset>
            )}

            {!memberLocked && inStock && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-6">
                <span className="text-muted text-xs uppercase tracking-widest">Quantity</span>
                <div className="flex items-center border border-border rounded-lg">
                  <button
                    type="button"
                    aria-label="Decrease quantity"
                    disabled={quantity <= 1}
                    onClick={() => setQuantity(q => Math.max(1, q - 1))}
                    className="focus-ring rounded-lg w-11 h-11 flex items-center justify-center text-lg text-muted hover:text-white active:scale-90 disabled:opacity-40 transition-all"
                  >
                    −
                  </button>
                  <span className="text-white font-semibold w-8 text-center" aria-live="polite">{quantity}</span>
                  <button
                    type="button"
                    aria-label="Increase quantity"
                    disabled={quantity >= stock}
                    onClick={() => setQuantity(q => Math.min(stock, q + 1))}
                    className="focus-ring rounded-lg w-11 h-11 flex items-center justify-center text-lg text-muted hover:text-white active:scale-90 disabled:opacity-40 transition-all"
                  >
                    +
                  </button>
                </div>
                <span className="text-muted text-xs">{stock} in stock</span>
              </div>
            )}

            <div className="hidden md:block">{purchaseAction}</div>
          </div>
        </div>
      </div>

      {/* Phone purchase bar. It follows the product details in reading and
          focus order, pins to the bottom of the screen while the product is on
          screen, then settles here above "You Might Also Like". No transformed
          ancestor (see the wrapper above). */}
      <StickyActionBar hideFrom="md" className="mt-6">
        {purchaseAction}
      </StickyActionBar>

      <ProductReviews productId={product.id} />

      {/* Related Products */}
      {related && related.length > 0 && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 md:pt-0 pb-12 md:pb-0">
          <h2 className="section-heading text-white mb-5 md:mb-8">You Might Also Like</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
            {related.map(p => (
              <div key={p.id} className="reveal">
                <ProductCard product={p} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
