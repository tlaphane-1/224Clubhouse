import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { CART_KEY, CART_CLEAR_EVENT } from './cartReducer'
import { AuthContext } from './useAuth'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [session, setSession] = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  // Driver portal access (is_driver() — the drivers table under RLS). Like
  // isAdmin it only drives UI; the driver RPCs enforce it server-side.
  const [isDriver, setIsDriver] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    // Resolve a promise to a fallback value if it doesn't settle in time, so a
    // stalled network request (common on mobile) can never hang the app.
    const withTimeout = (promise, ms, fallback) =>
      Promise.race([
        promise,
        new Promise(resolve => setTimeout(() => resolve(fallback), ms)),
      ])

    // Admin status is a SERVER-side boundary: the is_admin() RPC checks the
    // admin_users table under RLS. The client value only drives UI — RLS is
    // the real enforcement. Never trust a client-only allowlist.
    async function resolveAdmin(session) {
      if (!session?.user) return false
      try {
        const { data, error } = await supabase.rpc('is_admin')
        return !error && data === true
      } catch {
        return false
      }
    }

    async function resolveDriver(session) {
      if (!session?.user) return false
      try {
        const { data, error } = await supabase.rpc('is_driver')
        return !error && data === true
      } catch {
        return false
      }
    }

    // Initial load. `loading` is ALWAYS cleared (finally), and the admin check
    // is time-boxed, so the ProtectedRoute spinner can never spin forever — a
    // failed/slow check just falls back to "not admin" (bounce to login).
    async function init() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const [admin, driver] = await Promise.all([
          withTimeout(resolveAdmin(session), 8000, false),
          withTimeout(resolveDriver(session), 8000, false),
        ])
        if (!active) return
        setSession(session)
        setUser(session?.user ?? null)
        setIsAdmin(admin)
        setIsDriver(driver)
      } catch {
        if (active) setIsAdmin(false)
      } finally {
        if (active) setLoading(false)
      }
    }
    init()

    // This callback must NOT await Supabase calls. supabase-js runs some
    // callbacks (e.g. USER_UPDATED from updateUser) while holding its auth
    // lock, and any REST call needs that lock to read the token — awaiting
    // is_admin here deadlocked "set new password" forever. So: update the
    // session synchronously, and resolve admin status on the next tick.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return
      setSession(session)
      // Token refreshes keep the same identity — no need to re-check admin.
      if (event === 'TOKEN_REFRESHED') return
      setUser(session?.user ?? null)
      if (!session?.user) {
        setIsAdmin(false)
        setIsDriver(false)
        return
      }
      setTimeout(async () => {
        const [admin, driver] = await Promise.all([resolveAdmin(session), resolveDriver(session)])
        if (active) {
          setIsAdmin(admin)
          setIsDriver(driver)
        }
      }, 0)
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  const signIn = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    setSession(data.session)
    setUser(data.user)
    // Resolve admin before returning so callers can navigate without racing
    // the async onAuthStateChange handler. Time-boxed + guarded so a slow/failed
    // admin check can't leave the login button hanging on "Signing In…".
    const timeBoxed = (rpc) => Promise.race([
      supabase.rpc(rpc),
      new Promise(resolve => setTimeout(() => resolve({ data: false }), 8000)),
    ]).then(res => res?.data === true, () => false)
    const [admin, driver] = await Promise.all([timeBoxed('is_admin'), timeBoxed('is_driver')])
    setIsAdmin(admin)
    setIsDriver(driver)
    return { ...data, isAdmin: admin, isDriver: driver }
  }

  // Email confirmation is ON in Supabase Auth, so signUp returns NO session —
  // the caller shows a "check your email" state. The confirmation link lands on
  // redirectTo with tokens in the URL hash; detectSessionInUrl (default) picks
  // them up and onAuthStateChange fires SIGNED_IN. Callers detect an
  // already-registered email via data.user?.identities?.length === 0 (Supabase
  // obfuscates that case to prevent account enumeration).
  const signUp = async (email, password, { redirectTo } = {}) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: redirectTo ?? window.location.origin + '/checkout' },
    })
    if (error) throw error
    return data
  }

  const resendConfirmation = async (email, { redirectTo } = {}) => {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: redirectTo ?? window.location.origin + '/checkout' },
    })
    if (error) throw error
  }

  // Sends a password-recovery email. The link uses the default implicit flow:
  // it lands on /reset-password with tokens in the URL hash, which supabase-js
  // (detectSessionInUrl) exchanges for a recovery session automatically.
  // NOTE: the Supabase project's Auth redirect allowlist must include this
  // origin for redirectTo to be honoured (configured in the dashboard).
  const resetPassword = async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/reset-password',
    })
    if (error) throw error
  }

  // Set a new password for the current session's user — used by the
  // /reset-password page while a recovery session is active.
  const updatePassword = async (newPassword) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) throw error
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    setIsAdmin(false)
    setIsDriver(false)
    setUser(null)
    setSession(null)
    // Shared-device privacy: the cart must not survive sign-out. Clear the
    // persisted copy directly, and signal CartProvider (rendered below this
    // provider, so useCart isn't reachable here) to clear in-memory state.
    localStorage.removeItem(CART_KEY)
    window.dispatchEvent(new CustomEvent(CART_CLEAR_EVENT))
  }

  return (
    <AuthContext.Provider value={{ user, session, loading, signIn, signUp, resendConfirmation, resetPassword, updatePassword, signOut, isAdmin, isDriver }}>
      {children}
    </AuthContext.Provider>
  )
}
