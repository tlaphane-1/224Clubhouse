import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// Today's sales at a glance (store_today_summary, staff and admins). "Live":
// refreshed every 30 seconds while a screen shows it.
export function useTodaySummary({ enabled = true } = {}) {
  return useQuery({
    queryKey: ['today-summary'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('store_today_summary')
      if (error) throw error
      return data
    },
    enabled,
    refetchInterval: 30_000,
  })
}
