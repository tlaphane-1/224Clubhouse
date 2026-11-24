import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { jsonResponse } from '../_shared/cors.ts'
import { serviceClient } from '../_shared/supabaseClients.ts'

// Staff shift selfies are kept 90 days (POPIA), and uploads no shift uses are
// removed after a day (migration 20261125100000). Storage forbids deleting
// rows from storage.objects in SQL, so shift_selfies_to_purge() lists them
// and this removes them through the Storage API.
//
// Called by pg_cron only — deploy with --no-verify-jwt; the shared
// x-cron-secret header (vault `cart_reminders_cron_secret` == env CRON_SECRET)
// is the authentication, as for send-daily-summary.

const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? ''
const BUCKET = 'shift-selfies'

function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const x = enc.encode(a)
  const y = enc.encode(b)
  if (x.length !== y.length) return false
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]
  return diff === 0
}

serve(async (req) => {
  const given = req.headers.get('x-cron-secret') ?? ''
  if (!CRON_SECRET || !safeEqual(given, CRON_SECRET)) return jsonResponse({ error: 'Unauthorized' }, 401)

  const db = serviceClient()
  const { data, error } = await db.rpc('shift_selfies_to_purge')
  if (error) return jsonResponse({ error: error.message }, 500)

  const names: string[] = (data ?? []) as string[]
  let removed = 0
  // The Storage API takes up to 1000 paths per call; batch smaller to be safe.
  for (let i = 0; i < names.length; i += 100) {
    const batch = names.slice(i, i + 100)
    const res = await db.storage.from(BUCKET).remove(batch)
    if (res.error) return jsonResponse({ error: res.error.message, removed }, 500)
    removed += batch.length
  }
  return jsonResponse({ success: true, removed })
})
