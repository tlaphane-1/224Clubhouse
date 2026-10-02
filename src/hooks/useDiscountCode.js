import { useCallback, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

/**
 * Every discount code, newest first — the /admin/discounts list.
 *
 * Only admins get rows: discount_codes has a single `for all using
 * (is_admin())` policy and no public select, so this returns an empty list
 * (not an error) for anyone else. Lives here rather than in its own file so
 * both sides of the feature share one module.
 */
export function useAdminDiscountCodes() {
  return useQuery({
    queryKey: ['discount-codes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('discount_codes')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })
}

/**
 * Client-side mirror of discount_eval()'s arithmetic (migration
 * 20260814103000), used only to keep the ORDER SUMMARY honest if the cart
 * subtotal moves after a code was applied.
 *
 * This is a DISPLAY helper, never an authority: place_cod_order re-derives
 * the discount from the code and its own DB-priced subtotal and ignores
 * anything the client computed. Mirrors the SQL exactly — percent uses
 * integer division that truncates down, and the result is clamped to the
 * subtotal so a fixed-amount code can never pay for shipping.
 */
export function discountAmountCents(applied, subtotalCents) {
  if (!applied) return 0
  const subtotal = Math.max(0, Number(subtotalCents) || 0)
  const value = Number(applied.value) || 0
  const raw = applied.kind === 'percent' ? Math.floor((subtotal * value) / 100) : value
  return Math.min(Math.max(raw, 0), subtotal)
}

// Settle time before re-checking a code against a changed cart. Long enough
// that stepping a quantity 1 -> 5 costs one round trip, short enough that the
// summary can't sit on a stale discount while the customer reads it.
const REVALIDATE_DELAY_MS = 400

/**
 * Discount-code state for checkout.
 *
 * `apply` calls the `validate_discount_code` RPC — the only way a customer
 * can learn anything about a code, since discount_codes has no public SELECT
 * policy (a readable table would let anyone with the anon key enumerate every
 * live code). The RPC never throws for a bad code: it returns
 * `{ valid: false, reason }`, which lands in `error` for inline display.
 *
 * The applied code is kept IN AGREEMENT WITH THE CART. `discountAmountCents`
 * alone re-derives the money but not the *conditions*: a code with a minimum
 * spend stayed applied after the cart dropped below that minimum (remove an
 * item in another tab, or a stock clamp shrinking a line), so the summary and
 * the Place Order button advertised a discount that place_cod_order would then
 * refuse — taking the whole order down with it. So whenever the subtotal moves
 * away from the one the code was last proven against, the RPC is re-run
 * (debounced) and a code that has stopped qualifying is cleared with the
 * server's own sentence shown inline.
 *
 * Nothing here is trusted at order time. Checkout sends `applied.code` and
 * only the code; the server recomputes the amount.
 *
 * Returns:
 * - `applied`   — `{ code, kind, value, discount_cents }` or null
 * - `discountCents` — the amount to show, recomputed against the CURRENT
 *   subtotal rather than the one the code was validated against
 * - `error`     — the reason to show under the input, or null
 * - `checking`  — a validation request is in flight
 * - `revalidating` — a background re-check against a changed cart is in flight
 * - `apply(raw)` / `remove()` / `reject(reason)`
 *
 * `reject` exists for the order-time race: if the server refuses the code at
 * Place Order (expired, ran out, no longer a first order), Checkout clears it
 * and shows the server's sentence instead of a raw Postgres error.
 */
export function useDiscountCode(subtotalCents) {
  const [applied, setApplied] = useState(null)
  const [error, setError] = useState(null)
  const [checking, setChecking] = useState(false)
  const [revalidating, setRevalidating] = useState(false)
  // The subtotal `applied` was last proven valid against. null = nothing applied.
  const [validatedFor, setValidatedFor] = useState(null)

  const subtotal = Math.max(0, Number(subtotalCents) || 0)

  const apply = useCallback(async (raw) => {
    const code = String(raw ?? '').trim().toUpperCase()
    if (!code) {
      setError('Enter a discount code')
      return false
    }
    setChecking(true)
    setError(null)
    const { data, error: rpcError } = await supabase.rpc('validate_discount_code', {
      p_code: code,
      p_subtotal_cents: subtotal,
    })
    setChecking(false)

    if (rpcError) {
      // A transport/permission failure, not a verdict on the code.
      setError("Couldn't check that code. Please try again.")
      return false
    }
    if (!data?.valid) {
      setApplied(null)
      setValidatedFor(null)
      setError(data?.reason || 'That is not a valid code')
      return false
    }
    setApplied(data)
    setValidatedFor(subtotal)
    setError(null)
    return true
  }, [subtotal])

  const remove = useCallback(() => {
    setApplied(null)
    setValidatedFor(null)
    setError(null)
  }, [])

  const reject = useCallback((reason) => {
    setApplied(null)
    setValidatedFor(null)
    setError(reason || 'That code can no longer be used')
  }, [])

  // Re-check the applied code whenever the cart subtotal stops matching the one
  // it was validated against. `validatedFor` is what stops this looping: a
  // successful re-check pins it to the current subtotal, so the effect no-ops
  // until the cart moves again.
  const appliedCode = applied?.code ?? null
  useEffect(() => {
    if (!appliedCode || validatedFor === subtotal) return
    let cancelled = false
    const timer = setTimeout(async () => {
      setRevalidating(true)
      const { data, error: rpcError } = await supabase.rpc('validate_discount_code', {
        p_code: appliedCode,
        p_subtotal_cents: subtotal,
      })
      setRevalidating(false)
      if (cancelled) return

      // A transport failure is not a verdict — keep the code and try again on
      // the next cart change. place_cod_order is still the authority at
      // Place Order, and it fails closed with a sentence Checkout can show.
      if (rpcError) return

      if (!data?.valid) {
        setApplied(null)
        setValidatedFor(null)
        setError(data?.reason || 'That code can no longer be used with this cart')
        return
      }
      setApplied(data)
      setValidatedFor(subtotal)
    }, REVALIDATE_DELAY_MS)

    return () => { cancelled = true; clearTimeout(timer) }
  }, [appliedCode, subtotal, validatedFor])

  return {
    applied,
    discountCents: discountAmountCents(applied, subtotal),
    error,
    checking,
    revalidating,
    apply,
    remove,
    reject,
  }
}
