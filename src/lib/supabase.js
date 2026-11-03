import { createClient, processLock } from '@supabase/supabase-js'
import { tenant } from '../tenant'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Tells the database which store this browser is (current_tenant() reads the
// x-tenant header for signed-out requests; a signed-in user's store comes from
// their JWT claim instead). Added ONLY to PostgREST requests, not as a
// global.headers entry: supabase-js copies global headers onto Edge Function
// calls too, and the functions' CORS preflight (supabase/functions/_shared/
// cors.ts) does not allow x-tenant, so every browser invoke would be blocked.
const fetchWithTenant = (input, init = {}) => {
  const url = input instanceof Request ? input.url : String(input)
  const restUrl = `${String(supabaseUrl).replace(/\/+$/, '')}/rest/v1/`
  if (!url.startsWith(restUrl)) return fetch(input, init)
  const headers = new Headers(init.headers)
  headers.set('x-tenant', tenant.slug)
  return fetch(input, { ...init, headers })
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: fetchWithTenant },
  auth: {
    // The default browser auth lock uses the Web Locks API (navigator.locks)
    // with NO acquire timeout, so if a lock is ever left held the next
    // auth-dependent request (e.g. a Storage upload, which reads the session
    // for its auth header) waits forever — the app appears to "hang on
    // uploading" until a page reload creates a fresh client. processLock is an
    // in-memory lock that can't deadlock on the Web Locks API, and the finite
    // acquire timeout means a stuck lock surfaces as a retryable error, never
    // an infinite hang.
    lock: processLock,
    lockAcquireTimeout: 10000,
  },
})
