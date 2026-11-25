import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { tenant, pageTitle } from '../tenant'

// /m/:token — what a phone camera opens when someone scans a club card.
// Deliberately looks nothing up: the card only works on the club's tablet.
export default function MemberCardInfo() {
  useEffect(() => {
    document.title = pageTitle('Club card')
  }, [])

  return (
    <div className="min-h-screen pt-28 pb-20 px-4">
      <div className="max-w-md mx-auto bg-surface border border-border rounded-2xl p-6 text-center">
        <h1 className="font-heading text-2xl text-white mb-3">Club card</h1>
        <p className="text-muted text-sm mb-6">
          This is a {tenant.name} club card. Show it at the counter, or scan it on the table tablet at the club.
        </p>
        <Link to="/account" className="btn-gold min-h-11 px-6 inline-flex items-center justify-center">My account</Link>
      </div>
    </div>
  )
}
