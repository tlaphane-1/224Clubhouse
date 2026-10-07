import { lazy, Suspense, useMemo } from 'react'
import { Truck } from 'lucide-react'
import { useDeliveryLocation } from '../../hooks/useDelivery'

// Leaflet is ~150 KB; only load it when there's a driver to show.
const LiveMap = lazy(() => import('./LiveMap'))

// Rough road ETA from the straight-line distance: roads wind (~1.3x) and
// suburban driving averages ~30 km/h. Shown as "about", never as a promise.
function etaMinutes(distanceM) {
  return Math.max(1, Math.round((distanceM * 1.3) / (30000 / 60)))
}

function distanceLabel(m) {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`
}

function ago(iso) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s}s ago`
  return `${Math.round(s / 60)} min ago`
}

/**
 * Live driver position for a customer's order while it is out for delivery.
 * Needs the order number + the email it was placed with (same two factors as
 * /track). Renders nothing for any other status.
 */
export default function DeliveryTracker({ orderNumber, email, status }) {
  const live = status === 'out_for_delivery'
  const { data, isError } = useDeliveryLocation(orderNumber, email, live)
  const markers = useMemo(() => {
    if (!data) return []
    const list = [{ id: 'driver', lat: data.lat, lng: data.lng, label: data.driver_first_name || 'Driver' }]
    if (Number.isFinite(data.dest_lat) && Number.isFinite(data.dest_lng)) {
      list.push({ id: 'home', kind: 'home', lat: data.dest_lat, lng: data.dest_lng, label: 'You' })
    }
    return list
  }, [data])
  const distance = Number.isFinite(data?.distance_m) ? data.distance_m : null

  if (!live) return null

  return (
    <section className="bg-surface border border-border rounded-2xl p-5 sm:p-6" aria-labelledby="live-delivery">
      <div className="flex items-center gap-2 mb-3">
        <Truck size={18} className="text-gold" />
        <h2 id="live-delivery" className="text-white font-semibold text-sm uppercase tracking-widest">On its way</h2>
      </div>
      {data ? (
        <>
          {distance !== null && (
            <p className="text-white font-semibold mb-1" aria-live="polite">
              {distance < 150
                ? 'Arriving now'
                : `${distanceLabel(distance)} away · about ${etaMinutes(distance)} min`}
            </p>
          )}
          <p className="text-muted text-sm mb-3">
            <span className="text-white">{data.driver_first_name || 'Your driver'}</span> is on the way · updated {ago(data.updated_at)}
          </p>
          <Suspense fallback={<div className="h-64 skeleton rounded-xl" />}>
            <LiveMap markers={markers} className="h-64 sm:h-80" ariaLabel="Map showing your driver's current location" />
          </Suspense>
        </>
      ) : (
        <p className="text-muted text-sm">
          {isError
            ? "We couldn't load your driver's location just now — it will retry automatically."
            : "Your driver's location will appear here as soon as they're on the road."}
        </p>
      )}
    </section>
  )
}
