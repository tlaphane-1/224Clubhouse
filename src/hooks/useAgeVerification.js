import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'

// Server-side 21+ check (migration 20261008120000). place_cod_order refuses
// accounts without a 21+ date of birth on record; checkout uses these to ask
// for it once.

export function useAgeVerified() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['age-verified', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_age_verified')
      if (error) throw error
      return data === true
    },
    enabled: !!user,
  })
}

export function useSetDateOfBirth() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (dob) => {
      const { error } = await supabase.rpc('set_date_of_birth', { p_dob: dob })
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['age-verified', user?.id] }),
  })
}
