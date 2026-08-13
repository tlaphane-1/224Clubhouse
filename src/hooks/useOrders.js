import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { db } from '../lib/firebase'
import { ref, set } from 'firebase/database'

export function useOrders() {
  return useQuery({
    queryKey: ['orders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })
}

export function useOrder(id) {
  return useQuery({
    queryKey: ['order', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('id', id)
        .single()
      if (error) throw error
      return data
    },
    enabled: !!id,
  })
}

export function useUpdateOrderStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ orderId, status }) => {
      const { error } = await supabase.rpc('admin_update_order_status', {
        p_order_id: orderId,
        p_status: status,
      })
      if (error) throw error

      if (db) {
        await set(ref(db, `orders/${orderId}`), {
          status,
          updatedAt: new Date().toISOString(),
        })
      }

      // Status email — fire and forget. The status is already updated; if Resend is
      // misconfigured or slow the admin's workflow must not stall or show an error,
      // so this never blocks the mutation and never surfaces a failure.
      // Only the order id goes over the wire: the function verifies the caller is
      // an admin and reads recipient, name and the just-written status from the
      // row, so no caller can aim a branded email at an address of their choosing.
      supabase.functions
        .invoke('send-status-email', {
          body: { orderId },
        })
        .catch(() => {
          /* the status change stands with or without the email */
        })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] })
    },
  })
}
