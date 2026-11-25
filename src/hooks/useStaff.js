import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// Admin → Staff (migration 20261125100000). Staff are existing accounts of
// this store; adding one goes through admin_add_staff (admin-only RPC).

export function useStaffMembers() {
  return useQuery({
    queryKey: ['staff'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff_members')
        .select('user_id, full_name, active, created_at')
        .order('full_name')
      if (error) throw error
      return data
    },
  })
}

export function useAddStaff() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ email, fullName }) => {
      const { error } = await supabase.rpc('admin_add_staff', { p_email: email, p_full_name: fullName })
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['staff'] }),
  })
}

export function useSetStaffActive() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, active }) => {
      const { error } = await supabase.rpc('admin_set_staff_active', { p_user_id: userId, p_active: active })
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['staff'] }),
  })
}
