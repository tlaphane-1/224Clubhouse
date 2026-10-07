import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import tailwindConfig from '../../../tailwind.config.js'

// Leaflet + OpenStreetMap tiles: free, no API key. Markers are circle markers
// (no image assets, which bundlers otherwise break in Leaflet).
const BOKSBURG = [-26.2125, 28.2625]
// Leaflet styles markers with inline values; read the brand tokens rather than
// repeat hex (docs/DESIGN_SYSTEM.md), as toastTheme.js does.
const { gold, background, leaf } = tailwindConfig.theme.extend.colors

/**
 * @param markers [{ id, lat, lng, label, kind? }] — kind 'home' is the
 *                delivery address (leaf ring); anything else is a driver (gold).
 * @param className sizing (give it a height)
 */
export default function LiveMap({ markers, className = 'h-64', ariaLabel = 'Map' }) {
  const elRef = useRef(null)
  const mapRef = useRef(null)
  const layerRef = useRef(null)
  // How many points the view was last fitted to: refit when that changes
  // (e.g. the home point arrives after the driver), otherwise leave the
  // user's pan/zoom alone.
  const fittedCount = useRef(0)

  useEffect(() => {
    const map = L.map(elRef.current, { zoomControl: true, attributionControl: true }).setView(BOKSBURG, 13)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map)
    layerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return
    layer.clearLayers()
    const points = markers.filter(m => Number.isFinite(m.lat) && Number.isFinite(m.lng))
    for (const m of points) {
      const style = m.kind === 'home'
        ? { radius: 8, color: leaf, weight: 4, fillColor: background, fillOpacity: 1 }
        : { radius: 9, color: background, weight: 3, fillColor: gold, fillOpacity: 1 }
      L.circleMarker([m.lat, m.lng], style)
        .bindTooltip(m.label ?? '', { permanent: points.length > 1, direction: 'top', offset: [0, -8] })
        .addTo(layer)
    }
    const refit = points.length !== fittedCount.current
    if (points.length === 1) {
      // Follow a single driver; keep the user's zoom after the first fit.
      map.setView([points[0].lat, points[0].lng], refit ? 15 : map.getZoom())
    } else if (points.length > 1 && refit) {
      map.fitBounds(points.map(p => [p.lat, p.lng]), { padding: [40, 40], maxZoom: 16 })
    }
    fittedCount.current = points.length
  }, [markers])

  return <div ref={elRef} role="img" aria-label={ariaLabel} className={`w-full rounded-xl overflow-hidden border border-border isolate ${className}`} />
}
