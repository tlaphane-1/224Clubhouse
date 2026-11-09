import { useQuery } from '@tanstack/react-query'
import { MapPin, AlertTriangle } from 'lucide-react'
import { distanceKm, geocodeAddress, mapsLink } from '../../utils/geo'

// Where the customer's phone was when they ordered (set_order_pin) against
// where the typed address is. A big gap is a reason to phone before sending a
// driver, not proof of fraud: someone may order from work for home.
const NEAR_KM = 1
const FAR_KM = 5

export default function OrderLocation({ order }) {
  const hasPin = Number.isFinite(order.pin_lat) && Number.isFinite(order.pin_lng)
  const pin = hasPin ? { lat: order.pin_lat, lng: order.pin_lng } : null

  const { data: typed, isLoading, isError } = useQuery({
    queryKey: ['address-point', order.id],
    queryFn: () => geocodeAddress(order.shipping_address),
    enabled: hasPin,
    staleTime: Infinity,
    retry: false,
  })

  if (!hasPin) {
    return <p className="text-muted text-xs mt-2">No location shared. The customer typed the address only.</p>
  }

  const km = typed ? distanceKm(pin, typed) : null
  const tone = km == null ? 'text-muted' : km <= NEAR_KM ? 'text-green-400' : km <= FAR_KM ? 'text-yellow-400' : 'text-red-400'

  return (
    <div className="mt-2 space-y-1 text-xs">
      <a href={mapsLink(pin)} target="_blank" rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 min-h-11 text-gold hover:text-gold-light uppercase tracking-widest">
        <MapPin size={14} /> Customer&apos;s location{order.pin_accuracy_m ? ` (±${order.pin_accuracy_m} m)` : ''}
      </a>
      {isLoading ? (
        <p className="text-muted">Checking it against the typed address…</p>
      ) : isError || km == null ? (
        <p className="text-muted">Couldn&apos;t place the typed address on a map. Open the location to compare.</p>
      ) : (
        <p className={`${tone} inline-flex items-start gap-1.5`}>
          {km > FAR_KM && <AlertTriangle size={14} className="shrink-0 mt-px" />}
          {km <= NEAR_KM
            ? 'Matches the typed address.'
            : `Pin is ${km < 10 ? km.toFixed(1) : Math.round(km)} km from the typed address.${km > FAR_KM ? ' Call the customer before sending a driver.' : ''}`}
        </p>
      )}
    </div>
  )
}
