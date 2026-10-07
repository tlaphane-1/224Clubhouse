import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// Telegram group alerts (migration 20261008150000). Settings via admin RPCs;
// the bot token goes straight to the telegram-connect Edge Function and is
// stored encrypted server-side — it never comes back to the browser.

export function useAlertSettings() {
  return useQuery({
    queryKey: ['alert-settings'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_get_alert_settings')
      if (error) throw error
      return data
    },
  })
}

export function useUpdateAlertSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ enabled = null, kinds = null }) => {
      const { error } = await supabase.rpc('admin_update_alert_settings', { p_enabled: enabled, p_kinds: kinds })
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['alert-settings'] }),
  })
}

/** Calls telegram-connect and surfaces its own error message. */
export async function telegramAction(body) {
  const { data, error } = await supabase.functions.invoke('telegram-connect', { body })
  if (error) {
    let message = error.message
    try { message = (await error.context.json()).error ?? message } catch { /* keep generic */ }
    throw new Error(message)
  }
  return data
}
