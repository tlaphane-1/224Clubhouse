import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import toast from 'react-hot-toast'
import { RefreshCw } from 'lucide-react'
import { useMemberCard, useRotateMemberCard } from '../../hooks/useMemberCard'
import { memberCardUrl } from '../../utils/table'
import { tenant } from '../../tenant'

// The customer's club card: a QR they show at the counter or scan at the
// table. Anyone holding this code can be served as this customer, so "New
// code" is there if a screenshot gets shared.
export default function MemberCard() {
  const { data: token, isLoading, isError, refetch } = useMemberCard()
  const rotate = useRotateMemberCard()
  const [qr, setQr] = useState(null)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (!token) return undefined
    let active = true
    QRCode.toDataURL(memberCardUrl(tenant.domain.siteUrl, token), { margin: 1, width: 320 })
      .then(url => { if (active) setQr(url) })
      .catch(() => { if (active) setQr(null) })
    return () => { active = false }
  }, [token])

  const newCode = async () => {
    try {
      await rotate.mutateAsync()
      setConfirming(false)
      toast.success('New code ready. The old one no longer works.')
    } catch (err) {
      toast.error(err.message || 'Could not make a new code')
    }
  }

  return (
    <div className="bg-surface border border-border rounded-2xl p-6">
      <h2 className="text-white font-semibold text-sm uppercase tracking-widest mb-2">Club card</h2>
      <p className="text-muted text-xs mb-2">Show this at the counter, or scan it on the table tablet to see your orders and order again.</p>
      <p className="text-muted text-xs mb-5">Keep it to yourself: anyone with this code can see your orders at the club. If you shared it by mistake, tap New code.</p>
      {isLoading ? (
        <div className="w-48 h-48 mx-auto skeleton rounded-xl" aria-busy="true" />
      ) : isError ? (
        <p className="text-red-400 text-sm">
          Couldn&apos;t load your card.{' '}
          <button type="button" onClick={() => refetch()} className="underline min-h-11">Try again</button>
        </p>
      ) : (
        <div className="text-center">
          {qr
            ? <img src={qr} alt="Your club card QR code" className="w-48 h-48 mx-auto bg-white rounded-xl p-2" />
            : <div className="w-48 h-48 mx-auto skeleton rounded-xl" aria-hidden="true" />}
          {confirming ? (
            <div className="mt-5 space-y-2">
              <p className="text-muted text-xs">Your current code will stop working.</p>
              <div className="flex gap-2 justify-center">
                <button type="button" onClick={newCode} disabled={rotate.isPending} className="btn-gold min-h-11 px-5 text-xs uppercase tracking-widest">
                  {rotate.isPending ? 'Working…' : 'Yes, new code'}
                </button>
                <button type="button" onClick={() => setConfirming(false)} className="btn-outline min-h-11 px-5 text-xs uppercase tracking-widest">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirming(true)}
              className="focus-ring rounded-lg min-h-11 px-3 mt-4 inline-flex items-center gap-2 text-muted hover:text-white text-xs uppercase tracking-widest">
              <RefreshCw size={14} aria-hidden="true" /> New code
            </button>
          )}
        </div>
      )}
    </div>
  )
}
