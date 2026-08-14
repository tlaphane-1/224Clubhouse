import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft, CalendarDays, Clock, MapPin, Lock, Check, Ticket, Users,
} from 'lucide-react'
import { useEvent } from '../hooks/useEvents'
import { useMyReservationFor, useReserveEventSeats } from '../hooks/useEventReservations'
import { useMyMembership } from '../hooks/useMyMembership'
import { memberPurchaseGate } from '../utils/memberGate'
import { useAuth } from '../context/AuthContext'
import CustomerAuth from '../components/auth/CustomerAuth'
import Badge from '../components/ui/Badge'
import { formatZAR } from '../utils/formatCurrency'
import toast from 'react-hot-toast'

const ADDRESS = '224 Rondebult Ave, Libradene, Boksburg, 1459'
const MAX_PER_RESERVATION = 10

function formatLongDate(value) {
  if (!value) return null
  return new Date(value + 'T00:00:00').toLocaleDateString('en-ZA', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

function Panel({ children }) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-6 sm:p-8">{children}</div>
  )
}

export default function EventDetail() {
  // Routed by id: the events table has no slug column (checked against the
  // initial schema and every migration since).
  const { id } = useParams()
  const { data: event, isLoading, isError } = useEvent(id)
  const { user, loading: authLoading } = useAuth()
  const membership = useMyMembership()
  const { reservation, isLoading: reservationsLoading } = useMyReservationFor(id)
  const reserve = useReserveEventSeats()

  const [quantity, setQuantity] = useState(1)
  const [form, setForm] = useState({ name: '', phone: '' })
  const [justReserved, setJustReserved] = useState(null)

  useEffect(() => {
    document.title = event ? `${event.title} | 224 Clubhouse` : 'Event | 224 Clubhouse'
  }, [event])

  if (isLoading) {
    return (
      <div className="min-h-screen pt-28 flex items-center justify-center">
        <div className="text-muted animate-pulse">Loading...</div>
      </div>
    )
  }

  if (isError || !event) {
    return (
      <div className="min-h-screen pt-28 flex flex-col items-center justify-center px-4">
        <h2 className="font-heading text-2xl text-white mb-4">Event not found</h2>
        <Link to="/events" className="text-gold hover:text-gold-light flex items-center gap-2">
          <ArrowLeft size={16} /> Back to Events
        </Link>
      </div>
    )
  }

  const today = new Date().toISOString().split('T')[0]
  const isPast = event.date < today
  const seatsLeft = event.seats_remaining // null = unlimited
  const soldOut = seatsLeft === 0
  const maxQuantity = Math.max(
    1,
    Math.min(MAX_PER_RESERVATION, typeof seatsLeft === 'number' ? seatsLeft : MAX_PER_RESERVATION),
  )

  // Reuse the product member gate rather than re-deriving it: same fail-closed
  // rules (loading = not locked, errored = locked), just fed the event's flag.
  const memberLocked = memberPurchaseGate(user, membership).isLocked({
    is_member_only: event.is_members_only,
  })

  const unitPrice = event.ticket_price ?? 0
  const total = unitPrice * quantity

  async function handleReserve() {
    if (!form.name.trim() || !form.phone.trim()) {
      toast.error('Please fill in your name and phone number.')
      return
    }
    try {
      const result = await reserve.mutateAsync({
        eventId: event.id,
        quantity,
        customer: { name: form.name.trim(), phone: form.phone.trim() },
      })
      setJustReserved(result)
    } catch (err) {
      const msg = err?.message || ''
      if (/already have a reservation/i.test(msg)) {
        toast.error('You already have a reservation for this event.')
      } else if (/members only/i.test(msg)) {
        toast.error('This event is for active members only.')
      } else if (/fully booked|spot\(s\) left/i.test(msg)) {
        toast.error(msg)
      } else if (/already taken place/i.test(msg)) {
        toast.error('This event has already taken place.')
      } else if (/sign in required/i.test(msg)) {
        toast.error('Your session expired — please sign in again, then reserve.')
      } else {
        toast.error('We could not reserve your spot. Please try again.')
      }
      console.error(err)
    }
  }

  const confirmed = justReserved ?? reservation

  function renderReservePanel() {
    if (isPast) {
      return (
        <Panel>
          <h2 className="font-heading text-xl font-bold text-white mb-2">This event has passed</h2>
          <p className="text-muted text-sm leading-relaxed">
            Reservations are closed. Have a look at what&apos;s coming up next.
          </p>
          <Link to="/events" className="btn-outline w-full mt-6 py-3 text-sm uppercase tracking-widest inline-block text-center">
            Upcoming events
          </Link>
        </Panel>
      )
    }

    if (confirmed) {
      const qty = confirmed.quantity ?? 1
      const owed = confirmed.total_cents ?? unitPrice * qty
      return (
        <Panel>
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-full bg-gold/10 flex items-center justify-center shrink-0">
              <Check size={20} className="text-gold" />
            </div>
            <h2 className="font-heading text-xl font-bold text-white">You&apos;re on the list</h2>
          </div>
          <div className="space-y-3 text-sm mb-6">
            <div className="flex justify-between gap-4">
              <span className="text-muted uppercase tracking-widest text-xs pt-0.5">Spots</span>
              <span className="text-white font-semibold">{qty}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted uppercase tracking-widest text-xs pt-0.5">Pay at the door</span>
              <span className="text-gold font-semibold">{owed > 0 ? formatZAR(owed) : 'Free'}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted uppercase tracking-widest text-xs pt-0.5">Name on the list</span>
              <span className="text-white text-right">{confirmed.name ?? form.name ?? user?.email}</span>
            </div>
          </div>
          <div className="bg-gold/5 border border-gold/20 rounded-xl p-4 space-y-2">
            <p className="text-gold text-xs uppercase tracking-widest">On the night</p>
            <p className="text-muted text-xs leading-relaxed">
              Give your name at the door — you&apos;re on our list.
              {owed > 0 ? ` Settle ${formatZAR(owed)} in cash or by card when you arrive.` : ''}
              {' '}Bring ID: strictly 21+.
            </p>
            <p className="text-muted text-xs leading-relaxed">{ADDRESS}</p>
          </div>
          <p className="text-muted text-xs mt-4 leading-relaxed">
            Plans changed? Contact us and we&apos;ll release your spot.
          </p>
        </Panel>
      )
    }

    if (authLoading) {
      return (
        <Panel>
          <div className="flex justify-center py-8">
            <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
          </div>
        </Panel>
      )
    }

    if (!user) {
      return (
        <Panel>
          <CustomerAuth
            title="Sign in to reserve"
            subtitle="Your spot is tied to your account, so you can check it here any time."
          />
        </Panel>
      )
    }

    if (memberLocked) {
      return (
        <Panel>
          <div className="flex items-start gap-3 mb-5">
            <Lock size={18} className="text-gold mt-0.5 shrink-0" />
            <div>
              <p className="text-white font-semibold text-sm mb-1">Members only</p>
              <p className="text-muted text-sm leading-relaxed">
                This night is reserved for active 224 Clubhouse members. Memberships start at R10
                — apply online and pay at the club.
              </p>
            </div>
          </div>
          <Link to="/membership" className="btn-gold w-full py-3.5 flex items-center justify-center gap-2 text-sm uppercase tracking-widest">
            <Lock size={15} /> Become a member
          </Link>
        </Panel>
      )
    }

    // Checked BEFORE the sold-out state: a guest who already holds one of the
    // last spots must not be shown "fully booked" while their own reservation
    // is still loading. Also stops a Reserve button rendering before we know
    // they don't already hold one — the RPC would reject it and it would read
    // as a failure.
    if (reservationsLoading) {
      return (
        <Panel>
          <div className="flex flex-col items-center gap-4 py-8">
            <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
            <p className="text-muted text-sm">Checking your reservations…</p>
          </div>
        </Panel>
      )
    }

    if (soldOut) {
      return (
        <Panel>
          <h2 className="font-heading text-xl font-bold text-white mb-2">Fully booked</h2>
          <p className="text-muted text-sm leading-relaxed">
            Every spot for this event is taken. Spots do open up — check back, or contact us to be
            told if one frees up.
          </p>
        </Panel>
      )
    }

    return (
      <Panel>
        <h2 className="font-heading text-xl font-bold text-white mb-1">Reserve your spot</h2>
        <p className="text-muted text-sm mb-6 leading-relaxed">
          No online payment — reserve here and settle at the door on the night.
        </p>

        <div className="space-y-4">
          <div>
            <label className="text-xs text-muted uppercase tracking-widest block mb-1.5">Name *</label>
            <input
              className="input-base"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Name for the door list"
              maxLength={200}
            />
          </div>
          <div>
            <label className="text-xs text-muted uppercase tracking-widest block mb-1.5">Email Address</label>
            <input className="input-base opacity-60 cursor-not-allowed" type="email" value={user.email ?? ''} disabled />
            <p className="text-muted text-xs mt-1">Reservations are tied to your account email.</p>
          </div>
          <div>
            <label className="text-xs text-muted uppercase tracking-widest block mb-1.5">Phone Number *</label>
            <input
              className="input-base"
              type="tel"
              value={form.phone}
              onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
              placeholder="0XX XXX XXXX"
              maxLength={50}
            />
          </div>

          <div className="flex items-center gap-4">
            <span className="text-muted text-xs uppercase tracking-widest">Spots</span>
            <div className="flex items-center gap-3 border border-border rounded-lg p-1">
              <button
                type="button"
                onClick={() => setQuantity(q => Math.max(1, q - 1))}
                className="w-8 h-8 flex items-center justify-center text-muted hover:text-white transition-colors"
                aria-label="Fewer spots"
              >
                −
              </button>
              <span className="text-white font-semibold w-8 text-center">{quantity}</span>
              <button
                type="button"
                onClick={() => setQuantity(q => Math.min(maxQuantity, q + 1))}
                className="w-8 h-8 flex items-center justify-center text-muted hover:text-white transition-colors"
                aria-label="More spots"
              >
                +
              </button>
            </div>
            {typeof seatsLeft === 'number' && (
              <span className="text-muted text-xs">{seatsLeft} left</span>
            )}
          </div>

          <div className="border-t border-border pt-4 flex items-center justify-between">
            <span className="text-muted text-xs uppercase tracking-widest">Due at the door</span>
            <span className="font-heading text-2xl font-bold text-gold">
              {total > 0 ? formatZAR(total) : 'Free'}
            </span>
          </div>

          <button
            onClick={handleReserve}
            disabled={reserve.isPending}
            className="btn-gold w-full py-3.5 text-sm uppercase tracking-widest disabled:opacity-50"
          >
            {reserve.isPending ? 'Reserving...' : 'Reserve my spot'}
          </button>
          <p className="text-muted text-xs text-center leading-relaxed">
            Nothing is charged now. Pay cash or card at the door — 21+, ID required.
          </p>
        </div>
      </Panel>
    )
  }

  return (
    <div className="min-h-screen pt-28 pb-20 animate-fadeIn">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <Link to="/events" className="flex items-center gap-2 text-muted hover:text-gold text-sm mb-8 transition-colors">
          <ArrowLeft size={16} /> Back to Events
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-12">
          {/* Event */}
          <div>
            <div className="relative aspect-[16/9] bg-surface border border-border rounded-2xl overflow-hidden mb-8">
              {event.image_url ? (
                <img src={event.image_url} alt={event.title} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <span className="font-heading text-7xl font-bold text-gold/20">224</span>
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2 mb-4">
              {event.is_members_only && <Badge variant="members">Members Only</Badge>}
              {isPast && <Badge variant="cancelled">Past Event</Badge>}
              {soldOut && !isPast && <Badge variant="pending">Fully Booked</Badge>}
            </div>

            <h1 className="font-heading text-3xl md:text-4xl font-bold text-white mb-6">
              {event.title}
            </h1>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
              <div className="flex items-start gap-3">
                <CalendarDays size={18} className="text-gold mt-0.5 shrink-0" />
                <div>
                  <p className="text-muted text-xs uppercase tracking-widest mb-0.5">Date</p>
                  <p className="text-white text-sm">{formatLongDate(event.date)}</p>
                </div>
              </div>
              {event.time && (
                <div className="flex items-start gap-3">
                  <Clock size={18} className="text-gold mt-0.5 shrink-0" />
                  <div>
                    <p className="text-muted text-xs uppercase tracking-widest mb-0.5">Time</p>
                    <p className="text-white text-sm">{event.time}</p>
                  </div>
                </div>
              )}
              <div className="flex items-start gap-3">
                <MapPin size={18} className="text-gold mt-0.5 shrink-0" />
                <div>
                  <p className="text-muted text-xs uppercase tracking-widest mb-0.5">Location</p>
                  <p className="text-white text-sm">{event.location}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Ticket size={18} className="text-gold mt-0.5 shrink-0" />
                <div>
                  <p className="text-muted text-xs uppercase tracking-widest mb-0.5">Entry</p>
                  <p className="text-white text-sm">
                    {unitPrice > 0 ? `${formatZAR(unitPrice)} per person — pay at the door` : 'Free entry'}
                  </p>
                </div>
              </div>
              {typeof seatsLeft === 'number' && !isPast && (
                <div className="flex items-start gap-3">
                  <Users size={18} className="text-gold mt-0.5 shrink-0" />
                  <div>
                    <p className="text-muted text-xs uppercase tracking-widest mb-0.5">Availability</p>
                    <p className="text-white text-sm">
                      {seatsLeft > 0 ? `${seatsLeft} spot${seatsLeft === 1 ? '' : 's'} left` : 'Fully booked'}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {event.description && (
              <p className="text-muted leading-relaxed text-sm whitespace-pre-line">
                {event.description}
              </p>
            )}
          </div>

          {/* Reserve */}
          <div className="lg:sticky lg:top-28 lg:self-start">
            {renderReservePanel()}
          </div>
        </div>
      </div>
    </div>
  )
}
