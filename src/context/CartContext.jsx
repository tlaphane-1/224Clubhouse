import { createContext, useContext, useReducer, useEffect } from 'react'
import { cartReducer, CART_KEY, CART_CLEAR_EVENT } from './cartReducer'

const CartContext = createContext(null)

export function CartProvider({ children }) {
  const [items, dispatch] = useReducer(cartReducer, [], () => {
    try {
      const stored = localStorage.getItem(CART_KEY)
      return stored ? JSON.parse(stored) : []
    } catch {
      return []
    }
  })

  useEffect(() => {
    localStorage.setItem(CART_KEY, JSON.stringify(items))
  }, [items])

  // Sign-out privacy on shared devices: AuthContext.signOut dispatches this
  // event (AuthProvider renders above CartProvider, so it can't call useCart).
  useEffect(() => {
    const clear = () => dispatch({ type: 'CLEAR' })
    window.addEventListener(CART_CLEAR_EVENT, clear)
    return () => window.removeEventListener(CART_CLEAR_EVENT, clear)
  }, [])

  const addItem = (item, quantity = 1) => {
    dispatch({ type: 'ADD_ITEM', item: { ...item, quantity } })
  }

  const removeItem = (id) => {
    dispatch({ type: 'REMOVE_ITEM', id })
  }

  const updateQuantity = (id, quantity) => {
    dispatch({ type: 'UPDATE_QUANTITY', id, quantity })
  }

  const clearCart = () => {
    dispatch({ type: 'CLEAR' })
  }

  const cartCount = items.reduce((sum, i) => sum + i.quantity, 0)

  const cartSubtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0)

  return (
    <CartContext.Provider value={{ items, addItem, removeItem, updateQuantity, clearCart, cartCount, cartSubtotal }}>
      {children}
    </CartContext.Provider>
  )
}

export function useCart() {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used within CartProvider')
  return ctx
}
