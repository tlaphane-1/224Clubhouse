import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { rangeStartIso } from '../utils/salesReport'

// PostgREST caps a response at the project's max-rows (1000 by default), so a
// long range is read page by page instead of silently truncating the report.
const PAGE_SIZE = 1000

/**
 * Every order created in the range (admin-only under orders RLS), oldest first.
 * The range key is in the query key so each range caches separately.
 */
export function useSalesOrders(rangeKey) {
  return useQuery({
    queryKey: ['orders', 'report', rangeKey],
    queryFn: async () => {
      const start = rangeStartIso(rangeKey)
      const all = []
      for (let from = 0; ; from += PAGE_SIZE) {
        let query = supabase
          .from('orders')
          .select('*')
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, from + PAGE_SIZE - 1)
        if (start) query = query.gte('created_at', start)
        const { data, error } = await query
        if (error) throw error
        all.push(...data)
        if (data.length < PAGE_SIZE) break
      }
      return all
    },
  })
}
