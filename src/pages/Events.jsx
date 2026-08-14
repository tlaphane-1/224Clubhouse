import { useEffect, useMemo } from 'react'
import { Calendar, AlertTriangle } from 'lucide-react'
import { useEvents } from '../hooks/useEvents'
import { useMyEventReservations, isLiveReservation } from '../hooks/useEventReservations'
import EventCard from '../components/events/EventCard'

export default function Events() {
  const { data: events, isLoading, isError, refetch } = useEvents()
  // One query for the whole grid — the cards read their own state out of it.
  // Signed out this never runs (enabled: !!user), so the map is simply empty.
  const { data: reservations } = useMyEventReservations()

  const reservationByEvent = useMemo(() => {
    const map = new Map()
    for (const r of reservations ?? []) {
      if (isLiveReservation(r) && !map.has(r.event_id)) map.set(r.event_id, r)
    }
    return map
  }, [reservations])

  useEffect(() => {
    document.title = 'Events | 224 Clubhouse'
  }, [])

  return (
    <div
      className="min-h-screen pt-28 pb-20 animate-fadeIn"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-14">
          <p className="text-gold text-xs uppercase tracking-[0.4em] mb-3">What's On</p>
          <h1 className="font-heading text-4xl md:text-5xl font-bold text-white mb-3">Events</h1>
          <p className="text-muted max-w-xl">
            We don't just throw events. We host moments.
          </p>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-surface border border-border rounded-xl overflow-hidden animate-pulse">
                <div className="h-48 bg-border" />
                <div className="p-5 space-y-3">
                  <div className="h-4 bg-border rounded w-3/4" />
                  <div className="h-3 bg-border rounded w-1/2" />
                  <div className="h-3 bg-border rounded w-2/3" />
                </div>
              </div>
            ))}
          </div>
        ) : isError ? (
          <div className="bg-surface border border-red-500/20 rounded-2xl p-8 text-center max-w-md mx-auto animate-fadeIn">
            <AlertTriangle size={28} className="text-red-400 mx-auto mb-3" />
            <p className="text-white text-sm mb-5">
              Couldn't load events. Please check your connection and try again.
            </p>
            <button onClick={() => refetch()} className="btn-gold text-sm">
              Retry
            </button>
          </div>
        ) : events && events.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {events.map((event) => (
              <div
                key={event.id}
                className="animate-fadeIn"
              >
                <EventCard event={event} reservation={reservationByEvent.get(event.id) ?? null} />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Calendar size={48} className="text-muted mb-6" strokeWidth={1} />
            <h3 className="font-heading text-xl font-semibold text-white mb-2">No upcoming events</h3>
            <p className="text-muted text-sm">Check back soon — we host regularly.</p>
          </div>
        )}
      </div>
    </div>
  )
}
