import { supabase } from '../lib/supabase'

// First-party, cookie-free visitor analytics (migration 20261007140000).
// A random visitor id lives in localStorage and a session id in
// sessionStorage; neither is tied to an account. Events go to the track_event
// RPC fire-and-forget — analytics must never slow down or break the shop.

const VISITOR_KEY = '224-vid'
const SESSION_KEY = '224-sid'
const SOURCE_KEY = '224-src'

// Only the real site counts: not local dev, not Firebase preview channels.
const LIVE_HOSTS = ['224clubhouse.store', 'www.224clubhouse.store', '224clubhouse.web.app']
const BOT_UA = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|headless|lighthouse/i

let optedOut = false
/** Admins' own browsing is not counted (set from the auth state). */
export function setAnalyticsOptOut(value) {
  optedOut = Boolean(value)
}

function storedId(storage, key) {
  try {
    let id = storage.getItem(key)
    if (!id) {
      id = crypto.randomUUID()
      storage.setItem(key, id)
    }
    return id
  } catch {
    return null // storage blocked (private mode) — just don't count this visit
  }
}

/** Where this visit came from, decided once per session. Pure for testing. */
export function classifySource(search, referrer, ownHost) {
  const params = new URLSearchParams(search || '')
  const utm = params.get('utm_source')
  if (utm) return utm.toLowerCase().slice(0, 40)
  if (params.has('fbclid')) return 'facebook'
  if (params.has('gclid')) return 'google'
  let host = ''
  try { host = referrer ? new URL(referrer).hostname.toLowerCase() : '' } catch { host = '' }
  if (!host || host === ownHost || host.endsWith('224clubhouse.store')) return 'direct'
  const known = [
    ['google', /(^|\.)google\./], ['bing', /(^|\.)bing\.com$/], ['facebook', /facebook\.com$|fb\.me$/],
    ['instagram', /instagram\.com$/], ['whatsapp', /whatsapp\.(com|net)$|wa\.me$/],
    ['tiktok', /tiktok\.com$/], ['twitter', /(^|\.)t\.co$|twitter\.com$|x\.com$/],
  ]
  for (const [name, re] of known) if (re.test(host)) return name
  return host.replace(/^www\./, '').slice(0, 40)
}

/** Pure for testing. */
export function classifyDevice(userAgent, width) {
  if (/ipad|tablet|playbook|silk/i.test(userAgent) || (/android/i.test(userAgent) && !/mobile/i.test(userAgent))) {
    return 'tablet'
  }
  if (/mobi|iphone|ipod|android/i.test(userAgent) || width < 640) return 'mobile'
  return 'desktop'
}

function sessionSource() {
  try {
    let src = sessionStorage.getItem(SOURCE_KEY)
    if (!src) {
      src = classifySource(window.location.search, document.referrer, window.location.hostname)
      sessionStorage.setItem(SOURCE_KEY, src)
    }
    return src
  } catch {
    return null
  }
}

export function trackEvent(event, path = window.location.pathname) {
  if (optedOut || import.meta.env.DEV) return
  if (!LIVE_HOSTS.includes(window.location.hostname)) return
  if (navigator.webdriver || BOT_UA.test(navigator.userAgent)) return
  if (path.startsWith('/admin')) return

  const visitor = storedId(localStorage, VISITOR_KEY)
  const session = storedId(sessionStorage, SESSION_KEY)
  if (!visitor || !session) return

  supabase
    .rpc('track_event', {
      p_visitor: visitor,
      p_session: session,
      p_event: event,
      p_path: path,
      p_source: sessionSource(),
      p_device: classifyDevice(navigator.userAgent, window.innerWidth),
    })
    .then(() => {}, () => {}) // never surface analytics failures
}
