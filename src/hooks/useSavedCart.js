import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { fetchProductsByIds } from './useProducts'
import { toCartItem } from '../utils/variants'

// Server copy of a signed-in customer's cart (saved_carts, migration
// 20261005150000). It powers abandoned-cart reminders and lets the cart follow
// the customer to another device. Owner-only under RLS. Imperative helpers
// (not hooks) because CartProvider drives them from effects.

/** The minimal display snapshot the reminder email needs — never used for pricing. */
export function toSavedLines(items) {
  return items.slice(0, 50).map(i => ({
    id: i.id,
    ...(i.variant_id ? { variant_id: i.variant_id, variant_label: i.variant_label } : {}),
    name: i.name,
    price: i.price,
    quantity: i.quantity,
  }))
}

export async function fetchSavedCart(userId) {
  const { data, error } = await supabase
    .from('saved_carts')
    .select('items')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return Array.isArray(data?.items) ? data.items : []
}

export async function saveCart(userId, items) {
  const { error } = await supabase
    .from('saved_carts')
    .upsert({ user_id: userId, items: toSavedLines(items) }, { onConflict: 'user_id' })
  if (error) throw error
}

export async function deleteSavedCart(userId) {
  const { error } = await supabase.from('saved_carts').delete().eq('user_id', userId)
  if (error) throw error
}

/**
 * Rebuilds saved lines from TODAY'S product rows (same rules as Reorder):
 * current price and stock, unavailable products/options dropped, quantity
 * capped at stock.
 */
export async function rebuildCartLines(saved) {
  const products = await fetchProductsByIds([...new Set(saved.map(l => l.id).filter(Boolean))])
  const byId = new Map(products.map(p => [p.id, p]))
  const lines = []
  for (const line of saved) {
    const product = byId.get(line.id)
    if (!product || !product.is_available) continue
    const variant = line.variant_id
      ? (product.product_variants ?? []).find(v => v.id === line.variant_id && v.is_available)
      : null
    if (line.variant_id && !variant) continue
    if (!line.variant_id && (product.product_variants ?? []).length > 0) continue
    const item = toCartItem(product, variant)
    if (item.stock_quantity < 1) continue
    lines.push({ ...item, quantity: Math.min(Math.max(1, line.quantity | 0), item.stock_quantity) })
  }
  return lines
}

/** /unsubscribe?cart=<token> — turns off cart reminders for that customer. */
export function useStopCartReminders(token) {
  return useQuery({
    queryKey: ['stop-cart-reminders', token],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('stop_cart_reminders', { p_token: token })
      if (error) throw error
      return data === true
    },
    enabled: !!token,
    staleTime: Infinity,
    retry: 1,
  })
}
