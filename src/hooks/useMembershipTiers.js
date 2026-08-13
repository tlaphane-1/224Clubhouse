import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

/**
 * Public membership tiers, cheapest-first by sort_order.
 *
 * Reads membership_tiers under the `membership_tiers_public_select` RLS
 * policy (active tiers only — the .eq is belt-and-braces so an admin session,
 * which can see inactive tiers, renders the same public pricing page).
 * `perks` is a jsonb array of display strings.
 */
export function useMembershipTiers() {
  return useQuery({
    queryKey: ['membership-tiers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('membership_tiers')
        .select('id, slug, name, price_cents, duration_days, perks, sort_order')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
      if (error) throw error
      return (data ?? []).map(t => ({
        ...t,
        perks: Array.isArray(t.perks) ? t.perks : [],
      }))
    },
  })
}
