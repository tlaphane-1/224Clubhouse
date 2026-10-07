import { useReducer, useEffect, useRef, useState } from 'react'
import { cartReducer, CART_KEY, CART_CLEAR_EVENT } from './cartReducer'
import { CartContext } from './useCart'
import { useAuth } from './useAuth'
import { fetchSavedCart, saveCart, deleteSavedCart, rebuildCartLines } from '../hooks/useSavedCart'
import { trackEvent } from '../utils/analytics'

// Debounce for the server copy: steppers fire one change per tap.
const SAVE_DELAY_MS = 1500

export function CartProvider({ children }) {
  const [items, dispatch] = useReducer(cartReducer, [], () => {
    try {
      const stored = localStorage.getItem(CART_KEY)
      return stored ? JSON.parse(stored) : []
    } catch {
      return []
    }
  })
  const { user } = useAuth()
  const userId = user?.id ?? null
  // Latest items for the async restore below (read after awaits).
  const itemsRef = useRef(items)

  useEffect(() => {
    itemsRef.current = items
    localStorage.setItem(CART_KEY, JSON.stringify(items))
  }, [items])

  // Sign-out privacy on shared devices: AuthContext.signOut dispatches this
  // event (AuthProvider renders above CartProvider, so it can't call useCart).
  useEffect(() => {
    const clear = () => dispatch({ type: 'CLEAR' })
    window.addEventListener(CART_CLEAR_EVENT, clear)
    return () => window.removeEventListener(CART_CLEAR_EVENT, clear)
  }, [])

  // ---- Server copy for signed-in customers (saved_carts) ----------------
  // 1. On sign-in, an EMPTY local cart is filled from the saved one (rebuilt
  //    from today's prices and stock), so the cart follows the customer to
  //    another device and the reminder email's "Return to your cart" works.
  //    A non-empty local cart wins and overwrites the saved one.
  // 2. After that, every change is saved (debounced); an emptied cart deletes
  //    the row so no reminder goes out for it.
  // Saving waits for step 1, or the empty pre-restore cart would delete the
  // row it was about to restore from. Sign-out ends the session BEFORE the
  // cart is cleared (AuthContext.signOut), so clearing never deletes it.
  const [syncedUser, setSyncedUser] = useState(null)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    ;(async () => {
      try {
        if (itemsRef.current.length === 0) {
          const saved = await fetchSavedCart(userId)
          if (!cancelled && saved.length > 0) {
            const restored = await rebuildCartLines(saved)
            if (!cancelled && restored.length > 0 && itemsRef.current.length === 0) {
              dispatch({ type: 'LOAD', items: restored })
            }
          }
        }
      } catch (err) {
        // Restoring is a convenience: the local cart stands, saving still runs.
        console.warn('Saved cart could not be restored:', err?.message ?? err)
      } finally {
        if (!cancelled) setSyncedUser(userId)
      }
    })()
    return () => {
      cancelled = true
      // A later sign-in (even the same account) must restore again before saving.
      setSyncedUser(null)
    }
  }, [userId])

  useEffect(() => {
    if (!userId || syncedUser !== userId) return
    const timer = setTimeout(() => {
      const write = items.length > 0 ? saveCart(userId, items) : deleteSavedCart(userId)
      write.catch(err => console.warn('Saved cart could not be updated:', err?.message ?? err))
    }, SAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [items, userId, syncedUser])

  const addItem = (item, quantity = 1) => {
    dispatch({ type: 'ADD_ITEM', item: { ...item, quantity } })
    trackEvent('add_to_cart')
  }

  // `key` is cartLineKey(item) — see cartReducer.
  const removeItem = (key) => {
    dispatch({ type: 'REMOVE_ITEM', key })
  }

  const updateQuantity = (key, quantity) => {
    dispatch({ type: 'UPDATE_QUANTITY', key, quantity })
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
