import { useState } from 'react'
import { CheckCircle, ExternalLink, Undo2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useSetEftPayment, proofUrl } from '../../hooks/useEftPayments'
import { eftState } from '../../utils/orderStatus'
import { formatZAR } from '../../utils/formatCurrency'

const PILL = {
  awaiting: { label: 'Awaiting EFT', cls: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' },
  proof: { label: 'EFT proof to check', cls: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  paid: { label: 'EFT paid', cls: 'bg-green-500/10 text-green-400 border-green-500/20' },
}

/** Small payment-state pill for an order row; nothing for non-EFT orders. */
export function EftPill({ order }) {
  const state = eftState(order)
  if (!state) return null
  const { label, cls } = PILL[state]
  return <span className={`inline-block text-xs px-2 py-0.5 rounded-full border whitespace-nowrap ${cls}`}>{label}</span>
}

const dateFmt = (iso) => new Date(iso).toLocaleString('en-ZA', {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
})

/**
 * Expanded-row payment controls. The proof is the customer's claim; the
 * "Payment received" button is the admin's confirmation after checking FNB.
 */
export default function EftAdminPanel({ order }) {
  const setPayment = useSetEftPayment()
  const [amount, setAmount] = useState((order.total / 100).toFixed(2))
  const [opening, setOpening] = useState(false)

  if (order.payment_method !== 'eft') return null

  const openProof = async () => {
    setOpening(true)
    // Open the tab synchronously (popup blockers), then point it at the
    // signed URL once it arrives. Not 'noopener': that makes window.open
    // return null. The opener link is cut by hand instead.
    const tab = window.open('', '_blank')
    if (tab) tab.opener = null
    try {
      const url = await proofUrl(order.payment_proof_path)
      if (tab) tab.location.href = url
      else window.location.assign(url)
    } catch (err) {
      tab?.close()
      toast.error(err.message || 'Could not open the proof')
    } finally {
      setOpening(false)
    }
  }

  const markPaid = async () => {
    const cents = Math.round(parseFloat(amount) * 100)
    if (!(cents >= 0)) {
      toast.error('Enter the amount that reflected')
      return
    }
    if (cents < order.total && !window.confirm(
      `${formatZAR(cents)} is less than the order total of ${formatZAR(order.total)}. Mark as paid anyway?`,
    )) return
    try {
      await setPayment.mutateAsync({ orderId: order.id, received: true, amountCents: cents })
      toast.success('Payment marked received — the customer has been emailed')
    } catch (err) {
      toast.error(err.message || 'Could not record the payment')
    }
  }

  const undo = async () => {
    if (!window.confirm('Undo this payment confirmation?')) return
    try {
      await setPayment.mutateAsync({ orderId: order.id, received: false })
      toast.success('Payment confirmation removed')
    } catch (err) {
      toast.error(err.message || 'Could not undo')
    }
  }

  return (
    <div className="mt-5 pt-5 border-t border-border">
      <h4 className="text-gold text-xs uppercase tracking-widest mb-3">EFT payment</h4>

      {order.payment_proof_path ? (
        <button
          type="button"
          onClick={openProof}
          disabled={opening}
          className="focus-ring rounded-lg inline-flex items-center gap-1.5 min-h-11 text-gold hover:text-gold-light text-sm underline underline-offset-2 disabled:opacity-50"
        >
          <ExternalLink size={14} />
          View proof of payment
          <span className="text-muted no-underline">({dateFmt(order.payment_proof_uploaded_at)})</span>
        </button>
      ) : (
        <p className="text-muted text-sm mb-2">No proof of payment uploaded.</p>
      )}

      {order.paid_at ? (
        <div className="flex flex-wrap items-center gap-3 mt-2">
          <p className="flex items-center gap-2 text-sm text-green-400">
            <CheckCircle size={16} />
            {formatZAR(order.paid_amount_cents ?? order.total)} received {dateFmt(order.paid_at)}
          </p>
          <button
            type="button"
            onClick={undo}
            disabled={setPayment.isPending}
            className="focus-ring rounded-lg h-11 px-3 inline-flex items-center gap-1.5 text-muted hover:text-white text-xs disabled:opacity-50"
          >
            <Undo2 size={14} /> Undo
          </button>
        </div>
      ) : order.status !== 'cancelled' && (
        <div className="mt-2">
          <p className="text-muted text-xs mb-2">
            Check the FNB app first — a proof of payment can be faked. Look for the reference{' '}
            <span className="text-white">{order.customer_name}</span> and {formatZAR(order.total)}.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label htmlFor={`paid-amount-${order.id}`} className="block text-muted text-xs mb-1">Amount received (R)</label>
              <input
                id={`paid-amount-${order.id}`}
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                className="input-base text-sm w-36"
              />
            </div>
            <button
              type="button"
              onClick={markPaid}
              disabled={setPayment.isPending}
              className="focus-ring h-11 px-4 rounded-lg inline-flex items-center gap-1.5 text-sm border border-green-500/30 text-green-400 hover:bg-green-500/10 disabled:opacity-50 transition-colors"
            >
              <CheckCircle size={15} /> Payment received
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
