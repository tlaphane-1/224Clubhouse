import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

/**
 * The signed-in customer's own orders, newest first.
 *
 * The `orders_owner_select` RLS policy already limits reads to the caller's
 * rows, but the explicit user_id filter is still required: RLS policies OR
 * together, so an admin (who passes `orders_admin_select`) would otherwise
 * see every order on this page.
 */
export function useMyOrders() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['my-orders', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('id, order_number, status, total, created_at, items, payment_method')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
    enabled: !!user,
  })
}

/**
 * A single order belonging to the signed-in customer, for /orders/:id.
 *
 * Owner RLS already restricts reads, but (as above) the explicit user_id
 * filter is kept so an admin viewing this page can't open other customers'
 * orders by id. Returns null (not an error) when the order doesn't exist or
 * isn't theirs — maybeSingle keeps "not yours" indistinguishable from
 * "not found".
 */
export function useMyOrder(orderId) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['my-orders', user?.id, orderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('user_id', user.id)
        .eq('id', orderId)
        .maybeSingle()
      if (error) throw error
      return data
    },
    enabled: !!user && !!orderId,
  })
}

/**
 * The signed-in customer's most recent order — just the fields checkout needs
 * to prefill the delivery form. Same defensive user_id filter as above.
 */
export function useLastOrder() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['my-orders', user?.id, 'last'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('customer_name, customer_phone, shipping_address')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data
    },
    enabled: !!user,
  })
}
