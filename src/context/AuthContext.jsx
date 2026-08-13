import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { CART_KEY, CART_CLEAR_EVENT } from './cartReducer'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [session, setSession] = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
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

    // Initial load. `loading` is ALWAYS cleared (finally), and the admin check
    // is time-boxed, so the ProtectedRoute spinner can never spin forever — a
    // failed/slow check just falls back to "not admin" (bounce to login).
    async function init() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const admin = await withTimeout(resolveAdmin(session), 8000, false)
        if (!active) return
        setSession(session)
        setUser(session?.user ?? null)
        setIsAdmin(admin)
      } catch {
        if (active) setIsAdmin(false)
      } finally {
        if (active) setLoading(false)
      }
    }
    init()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      // Token refreshes keep the same identity — no need to re-check admin.
      if (event === 'TOKEN_REFRESHED') {
        if (active) setSession(session)
        return
      }
      const admin = await resolveAdmin(session)
      if (!active) return
      setSession(session)
      setUser(session?.user ?? null)
      setIsAdmin(admin)
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
    let admin = false
    try {
      const res = await Promise.race([
        supabase.rpc('is_admin'),
        new Promise(resolve => setTimeout(() => resolve({ data: false }), 8000)),
      ])
      admin = res?.data === true
    } catch {
      admin = false
    }
    setIsAdmin(admin)
    return data
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
    setUser(null)
    setSession(null)
    // Shared-device privacy: the cart must not survive sign-out. Clear the
    // persisted copy directly, and signal CartProvider (rendered below this
    // provider, so useCart isn't reachable here) to clear in-memory state.
    localStorage.removeItem(CART_KEY)
    window.dispatchEvent(new CustomEvent(CART_CLEAR_EVENT))
  }

  return (
    <AuthContext.Provider value={{ user, session, loading, signIn, signUp, resendConfirmation, resetPassword, updatePassword, signOut, isAdmin }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
