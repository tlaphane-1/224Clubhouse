import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export function useEvents() {
  return useQuery({
    queryKey: ['events'],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0]
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .gte('date', today)
        .order('date', { ascending: true })
      if (error) throw error
      return data
    },
  })
}

export function useAllEvents() {
  return useQuery({
    queryKey: ['events', 'admin', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .order('date', { ascending: false })
      if (error) throw error
      return data
    },
  })
}
