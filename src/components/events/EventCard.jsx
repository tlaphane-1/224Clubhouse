import { Link } from 'react-router-dom'
import { MapPin, Clock, Users, Check } from 'lucide-react'
import Badge from '../ui/Badge'
import { formatZAR } from '../../utils/formatCurrency'

/**
 * @param {object}      props.event        events row (may carry seats_remaining)
 * @param {object|null} props.reservation  the signed-in guest's live reservation
 *                                         for this event, if any
 */
export default function EventCard({ event, reservation = null }) {
  const date = new Date(event.date + 'T00:00:00')
  const day = date.toLocaleDateString('en-ZA', { day: '2-digit' })
  const month = date.toLocaleDateString('en-ZA', { month: 'short' }).toUpperCase()

  // seats_remaining is null when the event has no capacity set (unlimited).
  const soldOut = event.seats_remaining === 0
  const lowStock = typeof event.seats_remaining === 'number' && event.seats_remaining > 0
    && event.seats_remaining <= 10

  return (
    <Link
      to={`/events/${event.id}`}
      className="block bg-surface border border-border rounded-xl overflow-hidden
                 transition-all duration-300 hover:border-gold hover:shadow-lg hover:shadow-gold/10 group"
    >
      {/* Image */}
      <div className="relative h-48 bg-background overflow-hidden">
        {event.image_url ? (
          <img
            src={event.image_url}
            alt={event.title}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="font-heading text-5xl font-bold text-gold/20">224</span>
          </div>
        )}

        {/* Date Badge */}
        <div className="absolute top-4 left-4 bg-background/90 backdrop-blur-sm border border-border rounded-lg px-3 py-2 text-center min-w-[52px]">
          <div className="text-gold font-bold text-xl leading-none">{day}</div>
          <div className="text-muted text-xs tracking-wider mt-0.5">{month}</div>
        </div>

        {event.is_members_only && (
          <div className="absolute top-4 right-4">
            <Badge variant="members">Members Only</Badge>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-5">
        <h3 className="font-heading text-lg font-semibold text-white mb-3 group-hover:text-gold transition-colors">
          {event.title}
        </h3>

        <div className="space-y-2 mb-4">
          {event.time && (
            <div className="flex items-center gap-2 text-muted text-sm">
              <Clock size={14} className="text-gold flex-shrink-0" />
              <span>{event.time}</span>
            </div>
          )}
          <div className="flex items-center gap-2 text-muted text-sm">
            <MapPin size={14} className="text-gold flex-shrink-0" />
            <span className="truncate">{event.location}</span>
          </div>
        </div>

        {event.description && (
          <p className="text-muted text-sm leading-relaxed line-clamp-2 mb-4">
            {event.description}
          </p>
        )}

        {/* Reservation state beats availability copy — a guest already on the
            list doesn't need to be told the event is nearly full. */}
        {reservation ? (
          <div className="flex items-center gap-1.5 text-gold text-xs mb-3">
            <Check size={13} className="shrink-0" />
            <span>
              You&apos;re on the list
              {reservation.quantity > 1 ? ` — ${reservation.quantity} spots` : ''}
            </span>
          </div>
        ) : soldOut ? (
          <p className="text-muted text-xs mb-3">Fully booked</p>
        ) : lowStock ? (
          <p className="text-gold text-xs mb-3">{event.seats_remaining} spots left</p>
        ) : null}

        <div className="flex items-center justify-between pt-4 border-t border-border">
          {/* Honest copy: there is no online payment yet, so the price is what
              you settle at the door — not something you can buy here. */}
          <span className="text-xs text-muted uppercase tracking-widest">
            {event.ticket_price
              ? `${formatZAR(event.ticket_price)} at the door`
              : 'Free Entry'}
          </span>
          {event.is_members_only && (
            <div className="flex items-center gap-1 text-gold text-xs">
              <Users size={12} />
              <span>Members</span>
            </div>
          )}
        </div>
      </div>
    </Link>
  )
}
