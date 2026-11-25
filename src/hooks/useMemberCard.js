import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'

// The customer's club card token (migration 20261125140000), shown as a QR
// they scan at the counter or the table. "New code" replaces it.
export function useMemberCard() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['member-card', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_member_card')
      if (error) throw error
      return data
    },
    enabled: !!user,
    staleTime: Infinity,
  })
}

export function useRotateMemberCard() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('rotate_member_card')
      if (error) throw error
      return data
    },
    onSuccess: (token) => queryClient.setQueryData(['member-card', user?.id], token),
  })
}
