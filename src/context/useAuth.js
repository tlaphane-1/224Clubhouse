import { createContext, useContext } from 'react'

// Lives outside AuthContext.jsx so that file exports only a component, which
// Vite's React fast refresh requires to hot-swap it without a full reload.
export const AuthContext = createContext(null)

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
