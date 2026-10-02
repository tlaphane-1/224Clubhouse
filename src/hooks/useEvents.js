import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// `seats_remaining` is the event_seats_remaining() computed column added in
// migration 20260814102000 — NULL means unlimited. It is a SECURITY DEFINER
// aggregate, so it works for anon without exposing anyone's reservation row.
// NOTE: selecting it requires that migration to be applied — push the DB and
// this frontend together (same coupling as the membership release).
const EVENT_SELECT = '*, seats_remaining:event_seats_remaining'

export function useEvents() {
  return useQuery({
    queryKey: ['events'],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0]
      const { data, error } = await supabase
        .from('events')
        .select(EVENT_SELECT)
        .gte('date', today)
        .order('date', { ascending: true })
      if (error) throw error
      return data
    },
  })
}

/**
 * A single event for /events/:id.
 *
 * Routed by id, not slug: the events table has no slug column (verified
 * against the initial schema and every migration since).
 *
 * maybeSingle so a missing event resolves to null instead of throwing — the
 * detail page renders its own "event not found" state.
 */
export function useEvent(id) {
  return useQuery({
    queryKey: ['events', 'detail', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('events')
        .select(EVENT_SELECT)
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      return data
    },
    enabled: !!id,
  })
}

export function useAllEvents() {
  return useQuery({
    queryKey: ['events', 'admin', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('events')
        .select(EVENT_SELECT)
        .order('date', { ascending: false })
      if (error) throw error
      return data
    },
  })
}

/**
 * Sets (or clears) an event's reservation capacity from the admin door list.
 *
 * Direct table update — the `events_admin_update` policy from
 * 20260604120000 already restricts writes to admins. `capacity: null` means
 * unlimited, which is also the column's default.
 */
export function useUpdateEventCapacity() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, capacity }) => {
      const { error } = await supabase.from('events').update({ capacity }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['events'] }),
  })
}
