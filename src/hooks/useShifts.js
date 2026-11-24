import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'
import { tenant } from '../tenant'
import { selfiePath, dayBoundsSast, shiftsDayFilter } from '../utils/shifts'
import { shrinkPhoto, MAX_SELFIE_BYTES } from '../utils/shrinkPhoto'

// Staff shifts with a selfie (migration 20261125100000). The server stamps
// the times; the selfie goes to the private bucket under <tenant>/<uid>/.
const BUCKET = 'shift-selfies'

export function useMyOpenShift() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['my-open-shift', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_open_shift')
      if (error) throw error
      return data ?? null
    },
    enabled: !!user,
  })
}

function invalidateShifts(queryClient) {
  queryClient.invalidateQueries({ queryKey: ['my-open-shift'] })
  queryClient.invalidateQueries({ queryKey: ['shifts'] })
}

/** Uploads the selfie, then starts the shift with it. */
export function useStartShift() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (original) => {
      const file = await shrinkPhoto(original)
      if (file.size > MAX_SELFIE_BYTES) {
        throw new Error('That photo is too large to upload. Please take the selfie again.')
      }
      const path = selfiePath(tenant.slug, user.id, Date.now(), file.type)
      const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || 'image/jpeg' })
      if (up.error) throw up.error
      const { data, error } = await supabase.rpc('start_shift', { p_selfie_path: path })
      // A refused start leaves the uploaded selfie behind (staff cannot
      // delete); it is private and an admin can remove it.
      if (error) throw error
      return data
    },
    onSettled: () => invalidateShifts(queryClient),
  })
}

export function useEndShift() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('end_shift')
      if (error) throw error
      return data
    },
    onSettled: () => invalidateShifts(queryClient),
  })
}

/** Admin: every shift that started on a South African calendar day, with names. */
export function useShiftsForDay(dateIso) {
  return useQuery({
    queryKey: ['shifts', dateIso],
    queryFn: async () => {
      const { from, to } = dayBoundsSast(dateIso)
      const { data: shifts, error } = await supabase
        .from('shifts')
        .select('id, user_id, started_at, ended_at, selfie_path')
        // That day's shifts, plus any still open from an earlier day.
        .or(shiftsDayFilter(from, to))
      if (error) throw error
      // Names in a second query, not an embed: shifts has no FK to staff_members.
      const ids = [...new Set(shifts.map(s => s.user_id))]
      const { data: staff, error: staffError } = ids.length
        ? await supabase.from('staff_members').select('user_id, full_name').in('user_id', ids)
        : { data: [], error: null }
      if (staffError) throw staffError
      const names = Object.fromEntries(staff.map(s => [s.user_id, s.full_name]))
      return shifts.map(s => ({ ...s, full_name: names[s.user_id] ?? 'Admin' }))
    },
    enabled: !!dateIso,
  })
}

/** Admin: close someone's open shift (forgot to clock out, left early). */
export function useAdminEndShift() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (shiftId) => {
      const { data, error } = await supabase.rpc('admin_end_shift', { p_shift_id: shiftId })
      if (error) throw error
      return data
    },
    onSettled: () => invalidateShifts(queryClient),
  })
}

/** A 10-minute link to a selfie (own, or any in the store for an admin). */
export function useSelfieUrl(path) {
  return useQuery({
    queryKey: ['selfie-url', path],
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 600)
      if (error) throw error
      return data.signedUrl
    },
    enabled: !!path,
    staleTime: 5 * 60 * 1000,
  })
}
