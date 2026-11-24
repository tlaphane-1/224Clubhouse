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

/** "09:02" — a time of day in South Africa. */
export function formatSastTime(iso) {
  const d = new Date(Date.parse(iso) + SAST_OFFSET_MS)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

/** What the counter's shift card says. */
export function shiftStatusLabel(openShift, nowMs = Date.now()) {
  if (!openShift) return 'Not on shift'
  return `On shift since ${formatSastTime(openShift.started_at)} · ${shiftDuration(openShift.started_at, null, nowMs)}`
}

/** Admin list order: people still on shift first, then the newest start. */
export function sortShifts(rows) {
  return [...rows].sort((a, b) =>
    (a.ended_at ? 1 : 0) - (b.ended_at ? 1 : 0) || Date.parse(b.started_at) - Date.parse(a.started_at))
}

/** Today's date (YYYY-MM-DD) in South Africa. */
export function todaySast(nowMs = Date.now()) {
  return new Date(nowMs + SAST_OFFSET_MS).toISOString().slice(0, 10)
}

/** Size that fits a photo inside max×max without changing its shape. */
export function fitWithin(width, height, max) {
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

/** PostgREST or() filter: shifts started in [from, to), plus any still open from before. */
export function shiftsDayFilter(from, to) {
  return `and(started_at.gte.${from},started_at.lt.${to}),and(ended_at.is.null,started_at.lt.${to})`
}
