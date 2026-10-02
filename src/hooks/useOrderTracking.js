import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

/**
 * Live customer-facing order tracking. Calls the SECURITY DEFINER
 * `get_order_tracking` RPC, which returns the order only when the order number
 * and email match — anon clients cannot read the `orders` table directly.
 *
 * Returns the tracking object, or `null` when nothing matches.
 *
 * @param {string} orderNumber  e.g. "224-ABC123"
 * @param {string} email        the email used at checkout
 * @param {boolean} enabled     only run once the lookup form is submitted
 */
export function useOrderTracking(orderNumber, email, enabled) {
  return useQuery({
    queryKey: ['order-tracking', orderNumber, email],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_order_tracking', {
        p_order_number: orderNumber,
        p_email: email,
      })
      if (error) throw error
      return data ?? null
    },
    enabled: !!(orderNumber && email && enabled),
    // Live updates: poll while the page is open and refresh on focus.
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
  })
}
