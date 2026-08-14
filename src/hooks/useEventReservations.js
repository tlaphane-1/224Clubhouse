import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

/**
 * A reservation still occupies its seat unless it was cancelled — 'attended'
 * guests have already walked through the door. Shared by the customer UI and
 * the RPC's dedupe rule so both agree on what "you're on the list" means.
 */
export function isLiveReservation(r) {
  return r?.status === 'reserved' || r?.status === 'attended'
}

/**
 * The signed-in guest's own event reservations, newest first.
 *
 * The `event_reservations_owner_select` policy already limits reads to the
 * caller's rows, but the explicit user_id filter is still required: RLS
 * policies OR together, so an admin (who passes the admin ALL policy) would
 * otherwise pull every guest's reservation into the storefront — same
 * defensive convention as useMyOrders / useMyMembership.
 */
export function useMyEventReservations() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['my-event-reservations', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('event_reservations')
        .select('id, event_id, quantity, status, total_cents, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
    enabled: !!user,
  })
}

/**
 * The signed-in guest's live reservation for one event, or null.
 * Derived from the single list query above so a page showing many events
 * still makes one request.
 */
export function useMyReservationFor(eventId) {
  const query = useMyEventReservations()
  const reservation =
    (query.data ?? []).find(r => r.event_id === eventId && isLiveReservation(r)) ?? null
  return { ...query, reservation }
}

/**
 * Reserve seats. Creation is RPC-only — event_reservations has no insert
 * policy, and the server overrides the email with the account's, prices from
 * the event's current ticket_price and enforces capacity / members-only.
 */
export function useReserveEventSeats() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ eventId, quantity, customer }) => {
      const { data, error } = await supabase.rpc('reserve_event_seats', {
        p_event_id: eventId,
        p_quantity: quantity,
        p_customer: customer,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-event-reservations'] })
      // seats_remaining is computed server-side, so the event rows are stale now.
      queryClient.invalidateQueries({ queryKey: ['events'] })
    },
  })
}

/**
 * Admin door list for one event. Guarded by `enabled` so the query only runs
 * when a row is actually expanded — the admin ALL policy is what allows the
 * full read (name/email/phone are personal data).
 */
export function useEventReservations(eventId) {
  return useQuery({
    queryKey: ['event-reservations', eventId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('event_reservations')
        .select('id, name, email, phone, quantity, status, total_cents, created_at')
        .eq('event_id', eventId)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data
    },
    enabled: !!eventId,
  })
}

/**
 * Door-desk check-in / cancellation. Goes through the admin RPC rather than a
 * bare update so the status_history append (and the is_admin() check) can't be
 * skipped.
 */
export function useUpdateReservationStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, status }) => {
      const { data, error } = await supabase.rpc('admin_update_reservation_status', {
        p_id: id,
        p_status: status,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['event-reservations'] })
      // A cancellation releases capacity, so seats_remaining changed too.
      queryClient.invalidateQueries({ queryKey: ['events'] })
      queryClient.invalidateQueries({ queryKey: ['my-event-reservations'] })
    },
  })
}
