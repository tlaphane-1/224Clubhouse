import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// Table mode and table orders (migration 20261125140000). The tablet stays
// signed in as staff; each call carries the customer's scanned card token.

async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw error
  return data
}

export const useTableIdentify = () => useMutation({ mutationFn: (token) => rpc('table_identify', { p_token: token }) })

export const useSubmitTableRequest = () => useMutation({
  mutationFn: ({ token, items }) => rpc('table_submit_request', { p_token: token, p_items: items }),
})

export const useSubmitTableReview = () => useMutation({
  mutationFn: ({ token, productId, rating, body }) =>
    rpc('table_submit_review', { p_token: token, p_product_id: productId, p_rating: rating, p_body: body }),
})

/** Counter: the customer behind a scanned club card (staff on shift). */
export const useCardCustomer = () => useMutation({
  mutationFn: async (token) => (await rpc('card_customer', { p_token: token }))?.[0] ?? null,
})

/** Counter: table orders from the last 30 minutes, refreshed every 15 seconds. */
export function useTableRequests({ enabled }) {
  return useQuery({
    queryKey: ['table-requests'],
    queryFn: () => rpc('counter_table_requests', {}),
    enabled,
    refetchInterval: 15_000,
  })
}

export function useCloseTableRequest() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }) => rpc('counter_close_table_request', { p_id: id, p_status: status }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['table-requests'] }),
  })
}
