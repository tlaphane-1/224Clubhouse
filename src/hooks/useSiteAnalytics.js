import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

/** Admin-only visitor summary for the last `days` days (site_analytics RPC). */
export function useSiteAnalytics(days) {
  return useQuery({
    queryKey: ['site-analytics', days],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('site_analytics', { p_days: days })
      if (error) throw error
      return data
    },
    // Visitors arrive continuously; keep the page reasonably fresh.
    refetchInterval: 60_000,
  })
}
