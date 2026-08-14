import { formatZAR } from '../../utils/formatCurrency'

const SHIPPING_THRESHOLD = 50000 // R500 in cents
const SHIPPING_FEE = 8000 // R80 in cents

export { SHIPPING_THRESHOLD, SHIPPING_FEE }

/**
 * @param items          cart lines
 * @param subtotal       PRE-discount goods total, in cents
 * @param discountCents  amount taken off the goods, in cents (0 = none)
 * @param discountCode   the applied code, shown next to the discount row
 * @param children       optional slot between the items and the totals —
 *                       checkout puts the discount-code form here so the
 *                       input sits with the money it changes.
 */
export default function OrderSummary({
  items,
  subtotal,
  discountCents = 0,
  discountCode = null,
  children,
}) {
  // Free shipping is decided on the PRE-discount subtotal, matching
  // place_cod_order: a discount must never be able to remove free shipping
  // and leave the customer worse off for using it.
  const shippingFee = subtotal >= SHIPPING_THRESHOLD ? 0 : SHIPPING_FEE
  const discount = Math.min(Math.max(discountCents, 0), subtotal)
  const total = subtotal - discount + shippingFee

  return (
    <div className="bg-surface border border-border rounded-xl p-6">
      <h3 className="font-heading text-lg font-semibold text-white mb-5">Order Summary</h3>

      {/* Items */}
      <div className="space-y-3 mb-5">
        {items.map(item => (
          <div key={item.id} className="flex items-center gap-3">
            <div className="w-12 h-12 bg-background rounded-lg flex-shrink-0 overflow-hidden">
              {item.images?.[0] ? (
                <img src={item.images[0]} alt={item.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <span className="text-gold/30 font-heading text-xs font-bold">224</span>
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm truncate">{item.name}</p>
              <p className="text-muted text-xs">Qty: {item.quantity}</p>
            </div>
            <span className="text-white text-sm font-semibold flex-shrink-0">
              {formatZAR(item.price * item.quantity)}
            </span>
          </div>
        ))}
      </div>

      {/* Discount code form (slot) */}
      {children && <div className="border-t border-border pt-4 mb-4">{children}</div>}

      {/* Totals */}
      <div className="border-t border-border pt-4 space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-muted">Subtotal</span>
          <span className="text-white">{formatZAR(subtotal)}</span>
        </div>
        {discount > 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-muted">
              Discount{discountCode ? <span className="text-gold"> ({discountCode})</span> : null}
            </span>
            <span className="text-gold font-medium">−{formatZAR(discount)}</span>
          </div>
        )}
        <div className="flex justify-between text-sm">
          <span className="text-muted">Shipping</span>
          <span className={shippingFee === 0 ? 'text-green-400 font-medium' : 'text-white'}>
            {shippingFee === 0 ? 'FREE' : formatZAR(shippingFee)}
          </span>
        </div>
        {subtotal < SHIPPING_THRESHOLD && (
          <p className="text-muted text-xs">
            Add {formatZAR(SHIPPING_THRESHOLD - subtotal)} more for free shipping
          </p>
        )}
        <div className="flex justify-between pt-3 border-t border-border">
          <span className="text-white font-semibold">Total</span>
          <span className="text-gold font-bold text-lg">{formatZAR(total)}</span>
        </div>
      </div>
    </div>
  )
}
