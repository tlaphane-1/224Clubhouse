import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export function useNewsletterSubscribers() {
  return useQuery({
    queryKey: ['newsletter-subscribers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('newsletter_subscribers')
        .select('*')
        .order('subscribed_at', { ascending: false })
      if (error) throw error
      return data
    },
  })
}
