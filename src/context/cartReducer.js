// Pure cart state logic, extracted from CartContext.jsx so it can be shared
// with AuthContext (sign-out clears the cart) and unit-tested under vitest's
// node environment. No React, no DOM.

export const CART_KEY = '224-cart'

// Window event dispatched by AuthContext.signOut. AuthProvider renders ABOVE
// CartProvider (see App.jsx), so it can't call useCart — CartProvider listens
// for this event and dispatches CLEAR.
export const CART_CLEAR_EVENT = 'cart:clear'

export function cartReducer(state, action) {
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
