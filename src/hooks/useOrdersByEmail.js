import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

/**
 * All orders for an email address, newest first, via the SECURITY DEFINER
 * `get_orders_by_email` RPC — for customers who never recorded an order number.
 *
 * Summary rows only (number, status, total, date, item count); full detail still
 * needs the order number through `useOrderTracking`.
 *
 * @param {string} email    the email used at checkout
 * @param {boolean} enabled only run once the lookup form is submitted
 */
export function useOrdersByEmail(email, enabled) {
  return useQuery({
    queryKey: ['orders-by-email', email],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_orders_by_email', {
        p_email: email,
      })
      if (error) throw error
      return data ?? []
    },
    enabled: !!(email && enabled),
    refetchOnWindowFocus: true,
  })
}
