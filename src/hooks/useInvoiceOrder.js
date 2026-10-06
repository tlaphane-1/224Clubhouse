import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'

/**
 * One order for the printable invoice at /orders/:id/invoice. `orderId` is
 * the order's UUID — the same key /orders/:id (useMyOrder) uses.
 *
 * Customers: the explicit user_id filter mirrors useMyOrder, so a signed-in
 * user can only ever load their own order. Admins: the filter is dropped and
 * the `orders_admin_select` RLS policy lets them read any order (the client
 * isAdmin only picks the query shape — RLS is still the real boundary, so a
 * spoofed isAdmin just gets their own orders back).
 *
 * isAdmin is in the query key because it resolves a tick after sign-in; the
 * key change refetches with the admin shape. Returns null when not found.
 */
export function useInvoiceOrder(orderId) {
  const { user, isAdmin } = useAuth()
  return useQuery({
    queryKey: ['invoice-order', user?.id, isAdmin, orderId],
    queryFn: async () => {
      let query = supabase.from('orders').select('*').eq('id', orderId)
      if (!isAdmin) query = query.eq('user_id', user.id)
      const { data, error } = await query.maybeSingle()
      if (error) throw error
      return data
    },
    enabled: !!user && !!orderId,
  })
}
