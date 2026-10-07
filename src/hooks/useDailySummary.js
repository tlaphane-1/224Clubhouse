import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

/** Admin: today's (Johannesburg) summary — same numbers as the 07:00 email. */
export function useDailySummary() {
  return useQuery({
    queryKey: ['daily-summary', 'today'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_daily_summary', { p_day: null })
      if (error) throw error
      return data
    },
    refetchInterval: 5 * 60_000,
  })
}
