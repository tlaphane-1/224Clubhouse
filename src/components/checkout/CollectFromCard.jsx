import { MapPin, Clock } from 'lucide-react'
import { tenant } from '../../tenant'

// Where and when to collect, for a collect store (order online, collect at
// the club). Shown at checkout and on the customer's order pages.
export default function CollectFromCard({ className = '' }) {
  const { street, suburb, city, mapsLink } = tenant.contact
  const address = [street, suburb, city].filter(Boolean).join(', ')
  return (
    <div className={`border border-border rounded-xl p-4 ${className}`}>
      <h3 className="text-white font-semibold mb-3 text-sm uppercase tracking-widest">Collect from</h3>
      <p className="flex items-start gap-2 text-white text-sm">
        <MapPin size={16} className="text-gold mt-0.5 shrink-0" aria-hidden="true" />
        <span>{address}</span>
      </p>
      <p className="flex items-start gap-2 text-muted text-sm mt-2">
        <Clock size={16} className="text-gold mt-0.5 shrink-0" aria-hidden="true" />
        <span>{tenant.hours.status}</span>
      </p>
      {mapsLink && (
        <a
          href={mapsLink}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-outline inline-flex items-center justify-center min-h-[44px] px-4 mt-4 text-sm"
        >
          Open in Maps
        </a>
      )}
    </div>
  )
}
