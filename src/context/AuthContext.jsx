import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

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

  const signOut = async () => {
    await supabase.auth.signOut()
    setIsAdmin(false)
  }

  return (
    <AuthContext.Provider value={{ user, session, loading, signIn, signOut, isAdmin }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
