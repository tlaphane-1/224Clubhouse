// Pure helpers for staff shifts (selfie clock-in). Times are shown in South
// African time (UTC+2 all year, no daylight saving).

const SAST_OFFSET_MS = 2 * 60 * 60 * 1000

const EXT = { 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heic' }

/** Storage path for a shift selfie: <tenant>/<uid>/<time>.<ext> (the bucket policy checks the first two). */
export function selfiePath(tenantSlug, userId, nowMs, mime) {
  return `${tenantSlug}/${userId}/${nowMs}.${EXT[mime] ?? 'jpg'}`
}

/** "7h 05m" between start and end (or now, for an open shift). */
export function shiftDuration(startedAt, endedAt, nowMs = Date.now()) {
  const end = endedAt ? Date.parse(endedAt) : nowMs
  const minutes = Math.max(0, Math.floor((end - Date.parse(startedAt)) / 60000))
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

/** The instants a South African calendar day starts and ends. */
export function dayBoundsSast(dateIso) {
  const from = Date.parse(`${dateIso}T00:00:00Z`) - SAST_OFFSET_MS
  return {
    from: new Date(from).toISOString(),
    to: new Date(from + 24 * 60 * 60 * 1000).toISOString(),
  }
}
