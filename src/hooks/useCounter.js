import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// Counter tablet sales (migration 20261125120000). Every call is a staff-only
// RPC; the server re-prices, checks stock and stamps who served.

function useDebounced(value, ms) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return debounced
}

/** Customers matching a name, phone or email (at least 3 characters). */
export function useFindCustomers(query) {
  const q = useDebounced((query ?? '').trim(), 300)
  return useQuery({
    queryKey: ['counter-customers', q],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('counter_find_customers', { p_query: q })
      if (error) throw error
      return data ?? []
    },
    enabled: q.length >= 3,
  })
}

/** The customer's last 10 orders (by account, or by phone for a walk-in). */
export function useCustomerHistory({ userId, phone }) {
  const key = userId || (phone ?? '').trim()
  return useQuery({
    queryKey: ['counter-history', key],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('counter_customer_history', {
        p_user_id: userId ?? null,
        p_phone: userId ? null : phone,
      })
      if (error) throw error
      return data ?? []
    },
    enabled: !!key,
  })
}

export function useRecordSale() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ customer, items, method, idChecked }) => {
      const { data, error } = await supabase.rpc('record_counter_sale', {
        p_customer: { user_id: customer.userId ?? null, name: customer.name, phone: customer.phone },
        p_items: items,
        p_payment_method: method,
        p_id_checked: idChecked,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      queryClient.invalidateQueries({ queryKey: ['counter-history'] })
    },
  })
}
