import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export function useProducts(category = null) {
  return useQuery({
    queryKey: ['products', category],
    queryFn: async () => {
      let query = supabase
        .from('products')
        .select('*')
        .eq('is_available', true)
        .order('created_at', { ascending: false })

      if (category && category !== 'all') {
        query = query.eq('category', category)
      }

      const { data, error } = await query
      if (error) throw error
      return data
    },
  })
}

export function useProduct(slug) {
  return useQuery({
    queryKey: ['product', slug],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('slug', slug)
        .single()
      if (error) throw error
      return data
    },
    enabled: !!slug,
  })
}

export function useAllProducts() {
  return useQuery({
    queryKey: ['products', 'admin', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })
}
