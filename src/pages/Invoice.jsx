import { useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Download, FileText, AlertTriangle } from 'lucide-react'
import { useAuth } from '../context/useAuth'
import { useInvoiceOrder } from '../hooks/useInvoiceOrder'
import { formatZAR } from '../utils/formatCurrency'
import { statusLabel, paymentLabel } from '../utils/orderStatus'

// Seller details printed on every invoice. Same facts as Contact.jsx / Footer.jsx
// (there is no shared constant yet — keep these in step if the club moves).
const BUSINESS = {
  name: '224 Clubhouse',
  addressLines: ['224 Rondebult Road', 'Libradene, Boksburg', '1459, Gauteng'],
  phone: '075 086 8783',
  email: '224clubhouse@gmail.com',
  web: '224clubhouse.store',
}

// Printable invoice for one order (/orders/:id/invoice, :id = order UUID like
// /orders/:id). Rendered without PublicLayout; "Download PDF" is the browser's
// print dialog → "Save as PDF", and document.title becomes the file name.
export default function Invoice() {
  const { id } = useParams()
  const { user, isAdmin, loading: authLoading } = useAuth()
  const { data: order, isLoading, isError, refetch } = useInvoiceOrder(id)

  useEffect(() => {
    document.title = order?.order_number
      ? `Invoice ${order.order_number} | 224 Clubhouse`
      : 'Invoice | 224 Clubhouse'
  }, [order?.order_number])

  if (authLoading || (user && isLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!user || isError || !order) {
    return <InvoiceUnavailable signedOut={!user} failed={!!user && isError} onRetry={refetch} />
  }

  // An admin opening another customer's invoice (from /admin/orders) can't use
  // /orders/:id — that page only loads the viewer's own orders.
  const backToAdmin = isAdmin && order.user_id !== user.id
  const backHref = backToAdmin ? '/admin/orders' : `/orders/${order.id}`
  const backLabel = backToAdmin ? 'Back to orders' : 'Back to order'

  return (
    <div className="min-h-screen bg-background px-4 py-6 sm:py-10 print:bg-white print:p-0">
      {/* Toolbar — screen only */}
      <div className="print:hidden max-w-[210mm] mx-auto mb-6 flex flex-wrap items-center justify-between gap-4">
        <Link
          to={backHref}
          className="h-11 inline-flex items-center gap-2 text-muted hover:text-gold text-xs uppercase tracking-widest transition-colors"
        >
          <ArrowLeft size={14} />
          {backLabel}
        </Link>
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            onClick={() => window.print()}
            className="btn-gold h-11 px-6 text-xs uppercase tracking-widest inline-flex items-center gap-2"
          >
            <Download size={14} />
            Download PDF
          </button>
          <p className="text-muted text-xs">In the print dialog, choose “Save as PDF”.</p>
        </div>
      </div>

      <InvoiceSheet order={order} />
    </div>
  )
}

function InvoiceUnavailable({ signedOut, failed, onRetry }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-surface border border-border rounded-2xl p-8 text-center">
        {failed ? (
          <AlertTriangle size={28} className="text-red-400 mx-auto mb-3" />
        ) : (
          <FileText size={28} className="text-muted mx-auto mb-3" />
        )}
        <p className="text-white text-sm mb-1">
          {signedOut
            ? 'Sign in to see this invoice'
            : failed
              ? 'Something went wrong loading this invoice'
              : "We couldn't find that invoice"}
        </p>
        <p className="text-muted text-xs mb-6">
          {signedOut
            ? 'Invoices are only visible on the account that placed the order.'
            : failed
              ? 'Please try again in a moment.'
              : 'It may belong to a different account, or the link is out of date.'}
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          {failed && (
            <button type="button" onClick={() => onRetry()} className="btn-outline px-6 h-11 text-xs uppercase tracking-widest">
              Retry
            </button>
          )}
          <Link to="/orders" className="btn-gold px-6 py-3 text-xs uppercase tracking-widest">
            Go to My Orders
          </Link>
        </div>
      </div>
    </div>
  )
}

// DESIGN SYSTEM EXCEPTION (docs/DESIGN_SYSTEM.md §2): the invoice sheet is a
// printed document, so it uses white paper, black text and Tailwind neutral
// greys instead of the dark brand tokens — on screen and on paper alike.
// The white BrandLogo would vanish on white (browsers drop background
// graphics when printing), so the brand is a black font-heading wordmark.
function InvoiceSheet({ order }) {
  const {
    order_number,
    status,
    payment_method,
    created_at,
    customer_name,
    customer_email,
    customer_phone,
    subtotal,
    shipping_fee,
    total,
    // subtotal is the PRE-discount goods total; total = subtotal - discount + shipping.
    discount_cents = 0,
    discount_code = null,
    items = [],
    shipping_address: addr = {},
  } = order

  const cancelled = status === 'cancelled'
  const dateLabel = new Date(created_at).toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  return (
    <article className="max-w-[210mm] mx-auto bg-white text-black rounded-lg shadow-xl p-5 sm:p-10 text-xs sm:text-sm print:max-w-none print:rounded-none print:shadow-none print:p-0 print:text-sm">
      {/* Seller + title */}
      <header className="flex flex-col sm:flex-row print:flex-row sm:items-start sm:justify-between gap-4 pb-6 border-b border-neutral-300">
        <div>
          <p className="font-heading text-2xl sm:text-3xl font-bold leading-none">{BUSINESS.name}</p>
          <address className="not-italic text-neutral-600 mt-3 leading-relaxed">
            {BUSINESS.addressLines.map((line) => (
              <span key={line} className="block">{line}</span>
            ))}
            <span className="block mt-1">{BUSINESS.phone} · {BUSINESS.email}</span>
            <span className="block">{BUSINESS.web}</span>
          </address>
        </div>
        <div className="sm:text-right print:text-right">
          {/* Deliberately "Invoice", not "Tax invoice": the club has no VAT
              registration number on record, so a tax invoice would be invalid. */}
          <h1 className="font-heading text-2xl sm:text-3xl font-bold uppercase tracking-wide">Invoice</h1>
          {cancelled && (
            <p className="mt-1 inline-block border border-black px-2 py-0.5 text-xs font-bold uppercase tracking-widest">
              Cancelled
            </p>
          )}
          <dl className="mt-3 grid grid-cols-[auto_1fr] sm:grid-cols-[1fr_auto] print:grid-cols-[1fr_auto] gap-x-4 gap-y-1">
            <dt className="text-neutral-600">Invoice no.</dt>
            <dd className="font-mono font-semibold">{order_number}</dd>
            <dt className="text-neutral-600">Date</dt>
            <dd>{dateLabel}</dd>
            <dt className="text-neutral-600">Status</dt>
            <dd>{statusLabel(status)}</dd>
            <dt className="text-neutral-600">Payment</dt>
            <dd>{paymentLabel(payment_method)}</dd>
          </dl>
        </div>
      </header>

      {/* Bill to */}
      <section className="py-6 border-b border-neutral-300">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-neutral-500 mb-2">Bill to</h2>
        <p className="font-semibold">{customer_name}</p>
        <p className="text-neutral-700 break-all">{customer_email}</p>
        {customer_phone && <p className="text-neutral-700">{customer_phone}</p>}
        <address className="not-italic text-neutral-700 mt-2 leading-relaxed">
          {addr?.street && <span className="block">{addr.street}</span>}
          {addr?.apartment && <span className="block">{addr.apartment}</span>}
          {(addr?.city || addr?.province) && (
            <span className="block">{[addr?.city, addr?.province].filter(Boolean).join(', ')}</span>
          )}
          {addr?.postalCode && <span className="block">{addr.postalCode}</span>}
        </address>
      </section>

      {/* Line items. On a phone the unit-price column folds under the name. */}
      <table className="w-full mt-6 border-collapse">
        <thead>
          <tr className="border-b border-neutral-400 text-left text-xs uppercase tracking-widest text-neutral-500">
            <th scope="col" className="py-2 pr-2 font-semibold">Item</th>
            <th scope="col" className="py-2 px-2 font-semibold text-right">Qty</th>
            <th scope="col" className="py-2 px-2 font-semibold text-right hidden sm:table-cell print:table-cell">Unit price</th>
            <th scope="col" className="py-2 pl-2 font-semibold text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={`${item.id}-${item.variant_label ?? ''}-${i}`} className="border-b border-neutral-200 align-top">
              <td className="py-2 pr-2">
                {item.variant_label ? `${item.name} — ${item.variant_label}` : item.name}
                <span className="block text-neutral-500 sm:hidden print:hidden">
                  {formatZAR(item.price)} each
                </span>
              </td>
              <td className="py-2 px-2 text-right tabular-nums">{item.quantity}</td>
              <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap hidden sm:table-cell print:table-cell">
                {formatZAR(item.price)}
              </td>
              <td className="py-2 pl-2 text-right tabular-nums whitespace-nowrap">
                {formatZAR(item.price * item.quantity)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals */}
      <dl className="mt-4 ml-auto w-full sm:w-72 print:w-72 space-y-1.5">
        <div className="flex justify-between gap-4">
          <dt className="text-neutral-600">Subtotal</dt>
          <dd className="tabular-nums">{formatZAR(subtotal)}</dd>
        </div>
        {discount_cents > 0 && (
          <div className="flex justify-between gap-4">
            <dt className="text-neutral-600">Discount{discount_code ? ` (${discount_code})` : ''}</dt>
            <dd className="tabular-nums">−{formatZAR(discount_cents)}</dd>
          </div>
        )}
        <div className="flex justify-between gap-4">
          <dt className="text-neutral-600">Delivery</dt>
          <dd className="tabular-nums">{shipping_fee === 0 ? 'Free' : formatZAR(shipping_fee)}</dd>
        </div>
        <div className="flex justify-between gap-4 pt-2 mt-1 border-t border-neutral-400 text-base font-bold">
          <dt>Total</dt>
          <dd className="tabular-nums">{formatZAR(total)}</dd>
        </div>
      </dl>

      <footer className="mt-10 pt-4 border-t border-neutral-300 text-center text-neutral-600 space-y-1">
        <p className="font-semibold text-black">Thank you for your order</p>
        <p className="text-xs">Not for persons under 21</p>
      </footer>
    </article>
  )
}
