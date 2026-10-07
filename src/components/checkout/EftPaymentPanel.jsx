import { useRef } from 'react'
import { CheckCircle, Upload, FileCheck } from 'lucide-react'
import toast from 'react-hot-toast'
import EftDetails from './EftDetails'
import { useUploadPaymentProof, PROOF_ACCEPT } from '../../hooks/useEftPayments'
import { eftAwaitingPayment } from '../../utils/orderStatus'
import { formatZAR } from '../../utils/formatCurrency'

const dateFmt = (iso) => new Date(iso).toLocaleString('en-ZA', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
})

/**
 * EFT payment state on the customer's order page: paid → confirmation;
 * unpaid → bank details plus an optional proof-of-payment upload. Renders
 * nothing for non-EFT orders or ones with nothing left to pay.
 */
export default function EftPaymentPanel({ order }) {
  const inputRef = useRef(null)
  const upload = useUploadPaymentProof(order.id)

  if (order.payment_method !== 'eft') return null

  if (order.paid_at) {
    return (
      <div className="bg-green-500/10 border border-green-500/20 rounded-2xl p-5 flex items-start gap-3">
        <CheckCircle size={20} className="text-green-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-green-400 font-semibold text-sm">Payment received</p>
          <p className="text-muted text-xs mt-1">
            {formatZAR(order.paid_amount_cents ?? order.total)} confirmed on {dateFmt(order.paid_at)}.
          </p>
        </div>
      </div>
    )
  }

  if (!eftAwaitingPayment(order)) return null

  const handleFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // picking the same file again must still fire
    if (!file) return
    try {
      await upload.mutateAsync(file)
      toast.success("Proof of payment received — we'll confirm once it reflects.")
    } catch (err) {
      toast.error(err.message || 'Upload failed. Please try again.')
    }
  }

  const hasProof = Boolean(order.payment_proof_uploaded_at)

  return (
    <div className="bg-surface border border-border rounded-2xl p-5 sm:p-6 space-y-4">
      <EftDetails reference={order.customer_name || 'your name and surname'} amountLabel={formatZAR(order.total)} />

      {hasProof ? (
        <p className="flex items-start gap-2 text-sm">
          <FileCheck size={16} className="text-gold flex-shrink-0 mt-0.5" />
          <span className="text-muted">
            <span className="text-white">Proof of payment received</span> {dateFmt(order.payment_proof_uploaded_at)}.
            We'll confirm once the money reflects in our account.
          </span>
        </p>
      ) : (
        <p className="text-muted text-sm">
          Paid already? Upload your proof of payment so we can match it faster. We dispatch once
          the money reflects in our account.
        </p>
      )}

      <div>
        <input
          ref={inputRef}
          id={`proof-${order.id}`}
          type="file"
          accept={PROOF_ACCEPT}
          onChange={handleFile}
          className="sr-only"
          tabIndex={-1}
          disabled={upload.isPending}
        />
        <label
          htmlFor={`proof-${order.id}`}
          className={`btn-outline focus-ring h-11 px-5 text-xs uppercase tracking-widest inline-flex items-center gap-2 cursor-pointer ${upload.isPending ? 'opacity-50 pointer-events-none' : ''}`}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click() } }}
          tabIndex={0}
          role="button"
        >
          <Upload size={14} />
          {upload.isPending ? 'Uploading…' : hasProof ? 'Replace proof of payment' : 'Upload proof of payment'}
        </label>
        <p className="text-muted text-xs mt-2">Photo, screenshot or PDF, up to 5 MB.</p>
      </div>
    </div>
  )
}
