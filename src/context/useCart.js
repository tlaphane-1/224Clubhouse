import { createContext, useContext } from 'react'

// Lives outside CartContext.jsx so that file exports only a component, which
// Vite's React fast refresh requires to hot-swap it without a full reload.
export const CartContext = createContext(null)

export function useCart() {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used within CartProvider')
  return ctx
}
