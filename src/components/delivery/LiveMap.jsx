import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import tailwindConfig from '../../../tailwind.config.js'

// Leaflet + OpenStreetMap tiles: free, no API key. Markers are circle markers
// (no image assets, which bundlers otherwise break in Leaflet).
const BOKSBURG = [-26.2125, 28.2625]
// Leaflet styles markers with inline values; read the brand tokens rather than
// repeat hex (docs/DESIGN_SYSTEM.md), as toastTheme.js does.
const { gold, background } = tailwindConfig.theme.extend.colors

/**
 * @param markers [{ id, lat, lng, label }]
 * @param className sizing (give it a height)
 */
export default function LiveMap({ markers, className = 'h-64', ariaLabel = 'Map' }) {
  const elRef = useRef(null)
  const mapRef = useRef(null)
  const layerRef = useRef(null)
  const fittedRef = useRef(false)

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
      L.circleMarker([m.lat, m.lng], {
        radius: 9, color: background, weight: 3, fillColor: gold, fillOpacity: 1,
      }).bindTooltip(m.label ?? '', { permanent: points.length > 1, direction: 'top', offset: [0, -8] }).addTo(layer)
    }
    if (points.length === 1) {
      // Follow a single driver; keep the user's zoom after the first fit.
      map.setView([points[0].lat, points[0].lng], fittedRef.current ? map.getZoom() : 15)
      fittedRef.current = true
    } else if (points.length > 1 && !fittedRef.current) {
      map.fitBounds(points.map(p => [p.lat, p.lng]), { padding: [40, 40], maxZoom: 15 })
      fittedRef.current = true
    }
  }, [markers])

  return <div ref={elRef} role="img" aria-label={ariaLabel} className={`w-full rounded-xl overflow-hidden border border-border isolate ${className}`} />
}
