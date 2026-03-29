import { createContext, useContext, useReducer, useEffect } from 'react'

const CartContext = createContext(null)

const CART_KEY = '224-cart'

function cartReducer(state, action) {
  switch (action.type) {
    case 'ADD_ITEM': {
      const existing = state.find(i => i.id === action.item.id)
      if (existing) {
        return state.map(i =>
          i.id === action.item.id
            ? { ...i, quantity: Math.min(i.quantity + action.item.quantity, i.stock_quantity) }
            : i
        )
      }
      return [...state, action.item]
    }
    case 'REMOVE_ITEM':
      return state.filter(i => i.id !== action.id)
    case 'UPDATE_QUANTITY':
      return state.map(i =>
        i.id === action.id ? { ...i, quantity: Math.max(1, Math.min(action.quantity, i.stock_quantity)) } : i
      )
    case 'CLEAR':
      return []
    case 'LOAD':
      return action.items
    default:
      return state
  }
}

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
