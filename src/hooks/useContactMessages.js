import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export function useContactMessages() {
  return useQuery({
    queryKey: ['contact-messages'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contact_messages')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })
}
