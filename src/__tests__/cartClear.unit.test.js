/**
 * Pure unit test for the cart-clear-on-sign-out wiring. No DOM, no live DB —
 * vitest runs in the 'node' environment (vite.config.js), so the actual
 * window event listener can't be exercised here. Instead this pins the pieces
 * both sides of the wiring share (src/context/cartReducer.js):
 *   - the CLEAR reducer transition CartProvider dispatches on the event
 *   - the storage key + event name AuthContext.signOut and CartProvider must
 *     agree on (a rename on one side without the other breaks sign-out privacy)
 *
 * How to run (PowerShell):
 *   npx vitest run src/__tests__/cartClear.unit.test.js
 */
import { describe, it, expect } from 'vitest'
import { cartReducer, CART_KEY, CART_CLEAR_EVENT } from '../context/cartReducer'

describe('cart clear on sign-out', () => {
  it('CLEAR empties a populated cart', () => {
    const state = [
      { id: 'p1', price: 12000, quantity: 2, stock_quantity: 5 },
      { id: 'p2', price: 5000, quantity: 1, stock_quantity: 3 },
    ]
    expect(cartReducer(state, { type: 'CLEAR' })).toEqual([])
  })

  it('CLEAR on an already-empty cart stays empty', () => {
    expect(cartReducer([], { type: 'CLEAR' })).toEqual([])
  })

  it('storage key and clear-event name match what signOut clears/dispatches', () => {
    expect(CART_KEY).toBe('224-cart')
    expect(CART_CLEAR_EVENT).toBe('cart:clear')
  })
})
