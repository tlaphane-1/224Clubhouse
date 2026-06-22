import { createClient, processLock } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
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
