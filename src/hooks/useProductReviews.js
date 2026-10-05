import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'

// Product reviews (migration 20261005160000). The storefront reads approved
// reviews through the get_product_reviews RPC, which returns display fields
// only — the table itself is owner/admin-only under RLS.

export function useProductReviews(productId) {
  return useQuery({
    queryKey: ['product-reviews', productId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_product_reviews', { p_product_id: productId })
      if (error) throw error
      return data ?? { count: 0, average: null, reviews: [] }
    },
    enabled: !!productId,
  })
}

/** { eligible, review } for the signed-in customer; null when signed out. */
export function useMyReviewStatus(productId) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['my-review', productId, user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_review_status', { p_product_id: productId })
      if (error) throw error
      return data
    },
    enabled: !!productId && !!user,
  })
}

export function useSubmitReview(productId) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ rating, body, displayName }) => {
      const { data, error } = await supabase.rpc('submit_product_review', {
        p_product_id: productId,
        p_rating: rating,
        p_body: body,
        p_display_name: displayName,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-review', productId] })
      queryClient.invalidateQueries({ queryKey: ['product-reviews', productId] })
      queryClient.invalidateQueries({ queryKey: ['admin-reviews'] })
    },
  })
}

// ---- Admin ----------------------------------------------------------------

export function useAdminReviews(status) {
  return useQuery({
    queryKey: ['admin-reviews', status],
    queryFn: async () => {
      let query = supabase
        .from('product_reviews')
        .select('id, rating, body, display_name, status, created_at, updated_at, moderated_at, product_id, products(name, slug)')
        .order('created_at', { ascending: false })
        .limit(200)
      if (status !== 'all') query = query.eq('status', status)
      const { data, error } = await query
      if (error) throw error
      return data
    },
  })
}

export function useModerateReview() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, status }) => {
      const { error } = await supabase.from('product_reviews').update({ status }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-reviews'] })
      queryClient.invalidateQueries({ queryKey: ['product-reviews'] })
    },
  })
}

export function useDeleteReview() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('product_reviews').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-reviews'] })
      queryClient.invalidateQueries({ queryKey: ['product-reviews'] })
    },
  })
}
