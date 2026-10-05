// Pure cart state logic, extracted from CartContext.jsx so it can be shared
// with AuthContext (sign-out clears the cart) and unit-tested under vitest's
// node environment. No React, no DOM.
import { cartLineKey } from '../utils/variants'

export const CART_KEY = '224-cart'

// Window event dispatched by AuthContext.signOut. AuthProvider renders ABOVE
// CartProvider (see App.jsx), so it can't call useCart — CartProvider listens
// for this event and dispatches CLEAR.
export const CART_CLEAR_EVENT = 'cart:clear'

// Lines are identified by cartLineKey (product id, plus the option id when the
// product is sold in options), so 1g and 3.5g of the same flower are separate
// lines. Carts saved before options existed have no variant_id, so their key
// is the plain product id — unchanged.
export function cartReducer(state, action) {
  switch (action.type) {
    case 'ADD_ITEM': {
      const key = cartLineKey(action.item)
      const existing = state.find(i => cartLineKey(i) === key)
      if (existing) {
        return state.map(i =>
          cartLineKey(i) === key
            ? { ...i, quantity: Math.min(i.quantity + action.item.quantity, i.stock_quantity) }
            : i
        )
      }
      return [...state, action.item]
    }
    case 'REMOVE_ITEM':
      return state.filter(i => cartLineKey(i) !== action.key)
    case 'UPDATE_QUANTITY':
      return state.map(i =>
        cartLineKey(i) === action.key ? { ...i, quantity: Math.max(1, Math.min(action.quantity, i.stock_quantity)) } : i
      )
    case 'CLEAR':
      return []
    case 'LOAD':
      return action.items
    default:
      return state
  }
}
