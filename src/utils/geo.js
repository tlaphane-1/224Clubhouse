// Location helpers for the checkout pin (migration 20261110120000) and the
// admin's address check. Lookups use OpenStreetMap Nominatim straight from the
// browser (free; one request per tap or per opened order, far below its
// one-per-second limit). The privacy policy names it.

const NOMINATIM = 'https://nominatim.openstreetmap.org'

export const SA_PROVINCES = [
  'Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal',
  'Limpopo', 'Mpumalanga', 'Northern Cape', 'North West', 'Western Cape',
]

/** Great-circle distance in km. */
export function distanceKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

export const mapsLink = ({ lat, lng }) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`

/**
 * Checkout address fields from a Nominatim reverse result. Only fields it
 * actually knows are returned, so a lookup never blanks what the customer typed.
 */
export function addressFromNominatim(result) {
  const a = result?.address ?? {}
  const out = {}
  const street = [a.house_number, a.road].filter(Boolean).join(' ')
  if (street) out.street = street
  // Where OSM has no town name (e.g. Soshanguve) the suburb is an electoral
  // ward ("Tshwane Ward 34"), which no customer would write: leave City empty.
  const city = [a.city, a.town, a.village, a.suburb].find(v => v && !/\bward\s*\d+/i.test(v))
  if (city) out.city = city
  const province = SA_PROVINCES.find(p => p.toLowerCase() === String(a.state ?? '').toLowerCase())
  if (province) out.province = province
  if (/^\d{4}$/.test(String(a.postcode ?? ''))) out.postalCode = a.postcode
  return out
}

/** The phone's position. Rejects with a message fit to show the customer. */
export function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error("This browser can't share your location. Type your address instead."))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
      (err) => reject(new Error(err.code === 1
        ? "Location is blocked. Allow location for this site in your phone's settings, or type your address."
        : "Couldn't find your location. Try again outside or near a window, or type your address.")),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    )
  })
}

export async function reverseGeocode({ lat, lng }) {
  const res = await fetch(`${NOMINATIM}/reverse?format=jsonv2&addressdetails=1&zoom=18&lat=${lat}&lon=${lng}`, {
    headers: { 'Accept-Language': 'en' },
  })
  if (!res.ok) throw new Error(`Address lookup failed (${res.status})`)
  return addressFromNominatim(await res.json())
}

/** Map point for a typed delivery address, or null when nothing matches. */
export async function geocodeAddress(address = {}) {
  const q = [address.street, address.city, address.province, address.postalCode, 'South Africa'].filter(Boolean).join(', ')
  const res = await fetch(`${NOMINATIM}/search?format=json&limit=1&countrycodes=za&q=${encodeURIComponent(q)}`, {
    headers: { 'Accept-Language': 'en' },
  })
  if (!res.ok) throw new Error(`Address lookup failed (${res.status})`)
  const hit = (await res.json())?.[0]
  const lat = Number(hit?.lat)
  const lng = Number(hit?.lon)
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null
}
