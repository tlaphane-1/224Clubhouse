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
