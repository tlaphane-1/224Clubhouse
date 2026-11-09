import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { callerIsAdmin, callerTenant, serviceClient } from '../_shared/supabaseClients.ts'
import { DEFAULT_TENANT } from '../_shared/storeAlerts.ts'
import { storeFor } from '../_shared/stores.ts'
import { MailError } from '../_shared/mail.ts'
import { sendDriverWelcome } from '../_shared/driverWelcome.ts'

// (Re)sends a driver the "choose your password" email (Admin → Drivers →
// Send sign-in email). admin-create-driver sends the same email on its own.
//
// Callers: an admin, for a driver in THEIR store (store from the JWT, as in
// admin-create-driver); or an ops script holding the service-role key, which
// must name the store. The service role can already do anything this does.

const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

/** Constant-time compare (same as send-daily-summary). */
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const x = enc.encode(a)
  const y = enc.encode(b)
  if (x.length !== y.length) return false
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]
  return diff === 0
}

interface Payload {
  userId?: string
  tenant?: string
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader) return jsonResponse({ error: 'Not authenticated' }, 401)
    const body: Payload = await req.json()

    let tenant: string | null
    if (SERVICE_ROLE_KEY && safeEqual(authHeader, `Bearer ${SERVICE_ROLE_KEY}`)) {
      tenant = body.tenant && storeFor(body.tenant) ? body.tenant : null
      if (!tenant) return jsonResponse({ error: 'Name a known store in "tenant"' }, 400)
    } else {
      if (!(await callerIsAdmin(authHeader))) return jsonResponse({ error: 'Not authorized' }, 403)
      tenant = await callerTenant(authHeader)
      if (!tenant) return jsonResponse({ error: 'Could not work out your store' }, 500)
    }
    const store = storeFor(tenant)
    if (!store) return jsonResponse({ error: 'Unknown store' }, 500)

    const userId = (body.userId ?? '').trim()
    if (!userId) return jsonResponse({ error: 'userId is required' }, 400)

    const admin = serviceClient(tenant)
    const { data: driver, error: driverError } = await admin
      .from('drivers')
      .select('user_id, full_name, active')
      .eq('tenant', tenant)
      .eq('user_id', userId)
      .maybeSingle()
    if (driverError) return jsonResponse({ error: driverError.message }, 500)
    if (!driver) return jsonResponse({ error: 'No such driver in this store' }, 404)
    if (!driver.active) return jsonResponse({ error: 'This driver is disabled. Enable them first.' }, 409)

    const { data: found, error: userError } = await admin.auth.admin.getUserById(userId)
    if (userError || !found?.user?.email) return jsonResponse({ error: 'Could not find the driver\'s login' }, 404)
    // One login belongs to one store (accounts from before the stamp are 224's).
    const stamp = String(found.user.app_metadata?.tenant ?? '') || DEFAULT_TENANT
    if (stamp !== tenant) return jsonResponse({ error: 'That login belongs to another store' }, 409)

    const sent = await sendDriverWelcome(store, { email: found.user.email, fullName: driver.full_name })
    if (!sent.sent) return jsonResponse({ error: sent.reason }, 500)
    return jsonResponse({ success: true })
  } catch (e) {
    console.error('[send-driver-welcome]', e)
    if (e instanceof MailError && e.status === 429) return jsonResponse({ error: 'Too many emails right now. Try again in a minute.' }, 429)
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
