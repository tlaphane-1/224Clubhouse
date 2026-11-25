import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// Stock-take (migration 20261125130000). Changes go through counter_set_stock
// (staff on shift); the log is readable by admins (all) and staff (own).

export function useSetStock() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ productId, variantId, counted, reason, note }) => {
      const { data, error } = await supabase.rpc('counter_set_stock', {
        p_product_id: productId,
        p_variant_id: variantId ?? null,
        p_counted: counted,
        p_reason: reason,
        p_note: note || null,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      queryClient.invalidateQueries({ queryKey: ['stock-log'] })
      queryClient.invalidateQueries({ queryKey: ['today-summary'] })
    },
  })
}

/** Admin: the latest stock changes, with the staff member's name. */
export function useStockLog(limit = 100) {
  return useQuery({
    queryKey: ['stock-log', limit],
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from('stock_adjustments')
        .select('id, product_name, variant_label, old_qty, new_qty, reason, note, user_id, created_at')
        .order('created_at', { ascending: false })
        .limit(limit)
      if (error) throw error
      const ids = [...new Set(rows.map(r => r.user_id).filter(Boolean))]
      const { data: staff, error: staffError } = ids.length
        ? await supabase.from('staff_members').select('user_id, full_name').in('user_id', ids)
        : { data: [], error: null }
      if (staffError) throw staffError
      const names = Object.fromEntries(staff.map(s => [s.user_id, s.full_name]))
      return rows.map(r => ({ ...r, who: names[r.user_id] ?? 'Admin' }))
    },
  })
}
