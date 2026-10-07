import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { callerClient, callerIsAdmin, serviceClient } from '../_shared/supabaseClients.ts'

// Turns an order's delivery address into a map point (orders.dest_lat/lng,
// migration 20261008140000) so the customer's live map can show their home,
// the distance and an ETA, and the "driver nearby" email can fire.
//
// Called fire-and-forget by the driver portal when a delivery starts. Caller
// must be an admin or the order's assigned driver. Uses OpenStreetMap
// Nominatim (free; policy: identify yourself, max 1 request/second — one call
// per delivery is far below that). A miss is not an error: {found:false}.

const NOMINATIM = 'https://nominatim.openstreetmap.org/search'
const USER_AGENT = '224Clubhouse/1.0 (224clubhous@gmail.com)'

interface Address {
  street?: string
  apartment?: string
  city?: string
  province?: string
  postalCode?: string
}

async function geocode(q: string): Promise<{ lat: number; lng: number } | null> {
  const url = `${NOMINATIM}?format=json&limit=1&countrycodes=za&q=${encodeURIComponent(q)}`
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' } })
  if (!res.ok) return null
  const rows = await res.json()
  const hit = Array.isArray(rows) ? rows[0] : null
  const lat = Number(hit?.lat)
  const lng = Number(hit?.lon)
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { orderId } = await req.json()
    if (!orderId) return jsonResponse({ error: 'orderId is required' }, 400)

    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader) return jsonResponse({ error: 'Not authenticated' }, 401)

    const admin = serviceClient()
    const { data: order, error } = await admin
      .from('orders')
      .select('id, driver_id, shipping_address, dest_lat, dest_lng')
      .eq('id', orderId)
      .single()
    if (error || !order) return jsonResponse({ error: 'Order not found' }, 404)

    // Same check as send-status-email: an admin, or the assigned driver.
    let allowed = await callerIsAdmin(authHeader)
    if (!allowed && order.driver_id) {
      const caller = callerClient(authHeader)
      const jwt = authHeader.replace(/^Bearer\s+/i, '')
      const { data: userData } = await caller.auth.getUser(jwt)
      const { data: isDriver } = await caller.rpc('is_driver')
      allowed = userData?.user?.id === order.driver_id && isDriver === true
    }
    if (!allowed) return jsonResponse({ error: 'Not authorized' }, 403)

    if (order.dest_lat != null && order.dest_lng != null) {
      return jsonResponse({ found: true, lat: order.dest_lat, lng: order.dest_lng, cached: true })
    }

    const a = (order.shipping_address ?? {}) as Address
    const full = [a.street, a.city, a.province, a.postalCode, 'South Africa'].filter(Boolean).join(', ')
    const short = [a.street, a.city].filter(Boolean).join(', ')
    let point = full ? await geocode(full) : null
    if (!point && short && short !== full) point = await geocode(short)
    if (!point) return jsonResponse({ found: false })

    const { error: upErr } = await admin
      .from('orders')
      .update({ dest_lat: point.lat, dest_lng: point.lng, geocoded_at: new Date().toISOString() })
      .eq('id', orderId)
    if (upErr) return jsonResponse({ error: upErr.message }, 500)

    return jsonResponse({ found: true, ...point })
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
