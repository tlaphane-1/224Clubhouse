import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import QRCode from 'qrcode'
import toast from 'react-hot-toast'
import { Maximize2, RefreshCw, X } from 'lucide-react'
import BrandLogo from '../ui/BrandLogo'
import { useAuth } from '../../context/useAuth'
import { useMemberCard, useRotateMemberCard } from '../../hooks/useMemberCard'
import { memberCardUrl } from '../../utils/table'
import { memberNumber, cardStatus, cardName } from '../../utils/memberCard'
import { tenant } from '../../tenant'

// The customer's digital membership card: name, tier, validity and live
// status, plus the club card QR the counter and table tablet scan. The status
// comes from the membership as it is now, so a screenshot of an old card
// can't pass as active — the counter's scan checks again anyway.

const BADGE = {
  active: 'bg-green-500/10 text-green-400 border-green-500/30',
  pending: 'bg-gold/10 text-gold border-gold/30',
  expired: 'bg-surface text-muted border-border',
  none: 'bg-surface text-muted border-border',
}

const longDate = (iso) => new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
const monthYear = (iso) => new Date(iso).toLocaleDateString('en-ZA', { month: 'short', year: 'numeric' })

function useQr(token, width) {
  const [qr, setQr] = useState(null)
  useEffect(() => {
    if (!token) return undefined
    let active = true
    QRCode.toDataURL(memberCardUrl(tenant.domain.siteUrl, token), { margin: 1, width })
      .then(url => { if (active) setQr(url) })
      .catch(() => { if (active) setQr(null) })
    return () => { active = false }
  }, [token, width])
  return qr
}

function CardFace({ name, number, status, tierName, membership, qr, large = false }) {
  const badge = cardStatus(status)
  return (
    <div className={`relative overflow-hidden rounded-2xl border border-gold/40 bg-background ${large ? 'p-6' : 'p-5'}`}>
      <div className="flex items-center gap-3">
        <BrandLogo className={large ? 'h-14 w-auto' : 'h-10 w-auto'} decorative />
        <div className="min-w-0">
          <p className="font-heading text-white uppercase tracking-widest text-sm truncate">{tenant.shortName}</p>
          <p className="text-gold text-xs uppercase tracking-[0.3em]">Member</p>
        </div>
        <span className={`ml-auto shrink-0 text-[10px] uppercase tracking-widest border rounded-full px-2.5 py-1 ${BADGE[badge.tone]}`}>
          {badge.label}
        </span>
      </div>

      <div className={`flex items-end justify-between gap-4 ${large ? 'mt-8' : 'mt-6'}`}>
        <div className="min-w-0">
          <p className={`font-heading text-white uppercase tracking-wide truncate ${large ? 'text-2xl' : 'text-lg'}`}>{name}</p>
          {membership && status !== 'expired' && (
            <p className="text-muted text-xs mt-1">
              {tierName}{status === 'active' && membership.expires_at ? ` · valid to ${longDate(membership.expires_at)}` : ''}
            </p>
          )}
          {status === 'expired' && membership?.expires_at && (
            <p className="text-muted text-xs mt-1">Ended {longDate(membership.expires_at)}</p>
          )}
          {membership?.starts_at && (
            <p className="text-muted text-xs mt-1">Member since {monthYear(membership.starts_at)}</p>
          )}
          <p className="text-muted text-xs mt-2 font-mono tracking-wider">No. {number}</p>
        </div>
        {qr
          ? <img src={qr} alt="Membership card QR code" className={`shrink-0 bg-white rounded-lg p-1 ${large ? 'w-44 h-44' : 'w-24 h-24'}`} />
          : <div className={`shrink-0 skeleton rounded-lg ${large ? 'w-44 h-44' : 'w-24 h-24'}`} aria-hidden="true" />}
      </div>
    </div>
  )
}

export default function MemberCard({ membership, status, tierName }) {
  const { user } = useAuth()
  const { data: token, isLoading, isError, refetch } = useMemberCard()
  const rotate = useRotateMemberCard()
  const [confirming, setConfirming] = useState(false)
  const [full, setFull] = useState(false)
  const qr = useQr(token, 480)

  // Full screen: Escape closes it.
  useEffect(() => {
    if (!full) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setFull(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [full])

  const newCode = async () => {
    try {
      await rotate.mutateAsync()
      setConfirming(false)
      toast.success('New code ready. The old one no longer works.')
    } catch (err) {
      toast.error(err.message || 'Could not make a new code')
    }
  }

  const face = {
    name: cardName(membership, user),
    number: memberNumber(tenant.orderPrefix, user?.id),
    status: status ?? null,
    tierName,
    membership,
    qr,
  }

  return (
    <div className="bg-surface border border-border rounded-2xl p-6 space-y-4">
      <h2 className="text-white font-semibold text-sm uppercase tracking-widest">Membership card</h2>

      {isLoading ? (
        <div className="h-48 skeleton rounded-2xl" aria-busy="true" aria-label="Loading your card" />
      ) : isError ? (
        <p className="text-red-400 text-sm">
          Couldn&apos;t load your card.{' '}
          <button type="button" onClick={() => refetch()} className="underline min-h-11">Try again</button>
        </p>
      ) : (
        <CardFace {...face} />
      )}

      <p className="text-muted text-xs">
        Show this at the counter, or scan it on the table tablet to see your orders and order again.
        Keep it to yourself: anyone with this code can see your orders at the club.
      </p>

      {!membership && (
        <Link to="/membership" className="btn-gold w-full min-h-11 inline-flex items-center justify-center text-xs uppercase tracking-widest">
          Become a member
        </Link>
      )}

      {confirming ? (
        <div className="space-y-2">
          <p className="text-muted text-xs">Your current code will stop working.</p>
          <div className="flex gap-2">
            <button type="button" onClick={newCode} disabled={rotate.isPending} className="btn-gold min-h-11 px-5 text-xs uppercase tracking-widest">
              {rotate.isPending ? 'Working…' : 'Yes, new code'}
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="btn-outline min-h-11 px-5 text-xs uppercase tracking-widest">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setFull(true)} disabled={!qr}
            className="btn-outline min-h-11 px-4 inline-flex items-center gap-2 text-xs uppercase tracking-widest">
            <Maximize2 size={14} aria-hidden="true" /> Show full screen
          </button>
          <button type="button" onClick={() => setConfirming(true)}
            className="focus-ring rounded-lg min-h-11 px-3 inline-flex items-center gap-2 text-muted hover:text-white text-xs uppercase tracking-widest">
            <RefreshCw size={14} aria-hidden="true" /> New code
          </button>
        </div>
      )}

      {/* Portalled to <body>: the page's fade-in transform would otherwise trap
          the fixed overlay under the navbar. */}
      {full && createPortal(
        <div className="fixed inset-0 z-[100] bg-background flex flex-col items-center justify-center p-4 overflow-y-auto" role="dialog" aria-modal="true" aria-label="Membership card">
          <div className="w-full max-w-md">
            <CardFace {...face} large />
            <p className="text-muted text-xs text-center mt-4">Turn your screen brightness up for the scanner.</p>
            <button type="button" onClick={() => setFull(false)} autoFocus
              className="btn-outline w-full min-h-11 mt-4 inline-flex items-center justify-center gap-2 text-xs uppercase tracking-widest">
              <X size={14} aria-hidden="true" /> Close
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
