import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'

// Driver portal + live delivery tracking (migration 20261007150000).

const ACTIVE_STATUSES = ['pending', 'confirmed', 'preparing', 'out_for_delivery']

/** Driver: their assigned orders that are still to deliver, plus today's done ones. */
export function useDriverOrders() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['driver-orders', user?.id],
    queryFn: async () => {
      const since = new Date()
      since.setHours(0, 0, 0, 0)
      const { data, error } = await supabase
        .from('orders')
        .select('id, order_number, status, customer_name, customer_phone, shipping_address, items, total, payment_method, paid_at, delivery_started_at, created_at, status_history')
        .eq('driver_id', user.id)
        .or(`status.in.(${ACTIVE_STATUSES.join(',')}),and(status.eq.delivered,created_at.gte.${since.toISOString()})`)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data
    },
    enabled: !!user,
    refetchInterval: 30_000, // new assignments show up without a refresh
  })
}

function useDriverStatusMutation(rpc) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (orderId) => {
      const { error } = await supabase.rpc(rpc, { p_order_id: orderId })
      if (error) throw error
      // Customer status email — fire and forget, as on the admin side.
      supabase.functions.invoke('send-status-email', { body: { orderId } }).catch(() => {})
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['driver-orders'] }),
  })
}

export const useStartDelivery = () => useDriverStatusMutation('driver_start_delivery')
export const useCompleteDelivery = () => useDriverStatusMutation('driver_complete_delivery')

const SEND_EVERY_MS = 10_000

/**
 * Shares the phone's position while `active` (the driver has an order out for
 * delivery). Sends at most every 10 s, keeps the screen awake where the
 * browser allows it, and reports its state for the banner.
 * State: 'off' | 'starting' | 'sharing' | 'denied' | 'unsupported' | 'error'
 */
export function useLocationSharing(active) {
  // Only callback-driven results live in state; 'off' / 'unsupported' /
  // 'starting' are derived below (no setState in the effect body).
  const [state, setState] = useState('off')
  const supported = typeof navigator !== 'undefined' && 'geolocation' in navigator
  const [lastSentAt, setLastSentAt] = useState(null)
  const lastSend = useRef(0)

  useEffect(() => {
    if (!active || !supported) return undefined

    let wakeLock = null
    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator && document.visibilityState === 'visible') {
          wakeLock = await navigator.wakeLock.request('screen')
        }
      } catch { /* not allowed here (e.g. low battery) — tracking still works while the screen is on */ }
    }
    requestWakeLock()
    // The wake lock is released whenever the page is hidden; take it back.
    const onVisible = () => { if (document.visibilityState === 'visible') requestWakeLock() }
    document.addEventListener('visibilitychange', onVisible)

    const send = (pos) => {
      const now = Date.now()
      if (now - lastSend.current < SEND_EVERY_MS) return
      lastSend.current = now
      const c = pos.coords
      supabase.rpc('driver_update_location', {
        p_lat: c.latitude,
        p_lng: c.longitude,
        p_accuracy: c.accuracy ?? null,
        p_heading: Number.isFinite(c.heading) ? c.heading : null,
        p_speed: Number.isFinite(c.speed) ? c.speed : null,
      }).then(({ error }) => {
        if (error) setState('error')
        else {
          setState('sharing')
          setLastSentAt(new Date())
        }
      }, () => setState('error'))
    }

    const watchId = navigator.geolocation.watchPosition(
      send,
      (err) => setState(err.code === err.PERMISSION_DENIED ? 'denied' : 'error'),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    )

    return () => {
      navigator.geolocation.clearWatch(watchId)
      document.removeEventListener('visibilitychange', onVisible)
      wakeLock?.release().catch(() => {})
      setState('off')
    }
  }, [active, supported])

  const shown = !active ? 'off' : !supported ? 'unsupported' : state === 'off' ? 'starting' : state
  return { state: shown, lastSentAt }
}

/** Customer: the live position of the driver carrying this order (polls). */
export function useDeliveryLocation(orderNumber, email, enabled) {
  return useQuery({
    queryKey: ['delivery-location', orderNumber, email],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_delivery_location', {
        p_order_number: orderNumber,
        p_email: email,
      })
      if (error) throw error
      return data
    },
    enabled: !!(enabled && orderNumber && email),
    refetchInterval: 10_000,
  })
}

// ---- Admin ------------------------------------------------------------------

export function useDrivers() {
  return useQuery({
    queryKey: ['drivers'],
    queryFn: async () => {
      const { data, error } = await supabase.from('drivers').select('*').order('full_name')
      if (error) throw error
      return data
    },
  })
}

export function useCreateDriver() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ email, password, fullName, phone }) => {
      const { data, error } = await supabase.functions.invoke('admin-create-driver', {
        body: { email, password, fullName, phone },
      })
      if (error) {
        // Surface the function's own message (e.g. "Password must be…").
        let message = error.message
        try { message = (await error.context.json()).error ?? message } catch { /* keep generic */ }
        throw new Error(message)
      }
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['drivers'] }),
  })
}

export function useSetDriverActive() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, active }) => {
      const { error } = await supabase.from('drivers').update({ active }).eq('user_id', userId)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['drivers'] }),
  })
}

export function useAssignDriver() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ orderId, driverId }) => {
      const { error } = await supabase.rpc('admin_assign_driver', { p_order_id: orderId, p_driver_id: driverId })
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['orders'] }),
  })
}

export function useDriverLocations() {
  return useQuery({
    queryKey: ['driver-locations'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_driver_locations')
      if (error) throw error
      return data ?? []
    },
    refetchInterval: 15_000,
  })
}
