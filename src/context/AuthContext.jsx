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

    // Admin status is a SERVER-side boundary: the is_admin() RPC checks the
    // admin_users table under RLS. The client value only drives UI — RLS is
    // the real enforcement. Never trust a client-only allowlist.
    async function resolveAdmin(session) {
      if (!session?.user) return false
      const { data, error } = await supabase.rpc('is_admin')
      return !error && data === true
    }

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      const admin = await resolveAdmin(session)
      if (!active) return
      setSession(session)
      setUser(session?.user ?? null)
      setIsAdmin(admin)
      setLoading(false)
    })

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
    // Resolve admin before returning so callers can navigate without racing
    // the async onAuthStateChange handler (which would otherwise briefly see
    // a signed-in-but-not-yet-admin state and bounce off ProtectedRoute).
    const { data: adminData } = await supabase.rpc('is_admin')
    setSession(data.session)
    setUser(data.user)
    setIsAdmin(adminData === true)
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
