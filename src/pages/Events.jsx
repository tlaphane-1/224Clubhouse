import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { Calendar } from 'lucide-react'
import { useEvents } from '../hooks/useEvents'
import EventCard from '../components/events/EventCard'

export default function Events() {
  const { data: events, isLoading } = useEvents()

  useEffect(() => {
    document.title = 'Events | 224 Clubhouse'
  }, [])

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="min-h-screen pt-28 pb-20"
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
        ) : events && events.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {events.map((event, i) => (
              <motion.div
                key={event.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1, duration: 0.4 }}
              >
                <EventCard event={event} />
              </motion.div>
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
    </motion.div>
  )
}
