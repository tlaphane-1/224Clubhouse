import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { callerIsAdmin, callerTenant, serviceClient } from '../_shared/supabaseClients.ts'
import { DEFAULT_TENANT } from '../_shared/storeAlerts.ts'
import { storeFor } from '../_shared/stores.ts'
import { sendDriverWelcome } from '../_shared/driverWelcome.ts'

// Admin creates a driver login (migration 20261007150000_driver_portal).
// Creating an auth user needs the service role, so this runs server-side and
// only for a caller whose JWT passes is_admin().
//
// If the email already has an account, it is linked as a driver and its
// existing password is left alone (the response says so).
//
// Either way the driver is emailed a link to choose a password and open the
// driver portal (send-driver-welcome resends it).
//
// Everything happens in the CALLER's store. Without that, the service role
// (no x-tenant) resolves to 224: an Explosive 420 admin would create 224
// driver logins, and could link any 224 customer as a 224 driver who then sees
// 224's delivery addresses. An existing account from another store is refused,
// because one login belongs to one store.

interface Payload {
  email?: string
  password?: string
  fullName?: string
  phone?: string
}

interface FoundUser {
  id: string
  tenant: string
}

async function findUserByEmail(email: string): Promise<FoundUser | null> {
  const admin = serviceClient()
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    const hit = data.users.find(u => (u.email ?? '').toLowerCase() === email)
    if (hit) {
      // Accounts from before the store stamp were backfilled to 224 (20261102160000).
      const tenant = String(hit.app_metadata?.tenant ?? '') || DEFAULT_TENANT
      return { id: hit.id, tenant }
    }
    if (data.users.length < 1000) return null
  }
  return null
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader) return jsonResponse({ error: 'Not authenticated' }, 401)
    if (!(await callerIsAdmin(authHeader))) return jsonResponse({ error: 'Not authorized' }, 403)
    const tenant = await callerTenant(authHeader)
    if (!tenant) return jsonResponse({ error: 'Could not work out your store' }, 500)

    const body: Payload = await req.json()
    const email = (body.email ?? '').trim().toLowerCase()
    const password = body.password ?? ''
    const fullName = (body.fullName ?? '').trim()
    const phone = (body.phone ?? '').trim() || null

    if (!/^\S+@\S+\.\S+$/.test(email)) return jsonResponse({ error: 'Enter a valid email address' }, 400)
    if (!fullName) return jsonResponse({ error: "Enter the driver's name" }, 400)

    const admin = serviceClient(tenant)
    const existing = await findUserByEmail(email)
    let userId: string
    let linkedExisting = false

    if (existing) {
      if (existing.tenant !== tenant) {
        return jsonResponse({ error: 'That email already has an account with another store. Use a different email for this driver.' }, 409)
      }
      userId = existing.id
      linkedExisting = true
    } else {
      // Optional: with none, the driver chooses one from the welcome email.
      if (password && password.length < 8) return jsonResponse({ error: 'Password must be at least 8 characters' }, 400)
      // user_metadata.tenant is what stamp_user_tenant reads at insert; passing
      // no app_metadata keeps GoTrue from overwriting that stamp afterwards.
      const { data, error } = await admin.auth.admin.createUser({
        email,
        ...(password ? { password } : {}),
        email_confirm: true, // the admin vouches for the address; no confirmation email
        user_metadata: { full_name: fullName, role: 'driver', tenant },
      })
      if (error || !data.user) return jsonResponse({ error: error?.message ?? 'Could not create the login' }, 400)
      userId = data.user.id
    }

    // serviceClient(tenant) sends x-tenant, so drivers.tenant defaults to the
    // caller's store (current_tenant()).
    const { error: rowError } = await admin
      .from('drivers')
      .upsert({ user_id: userId, full_name: fullName, phone, active: true, tenant }, { onConflict: 'user_id' })
    if (rowError) return jsonResponse({ error: rowError.message }, 500)

    // The driver exists either way; a failed email is reported, not fatal, and
    // the admin can resend it from the Drivers page.
    let welcomeEmail: { sent: boolean; reason?: string }
    try {
      const store = storeFor(tenant)
      welcomeEmail = store
        ? await sendDriverWelcome(store, { email, fullName })
        : { sent: false, reason: `Unknown store ${tenant}` }
    } catch (e) {
      console.error('[admin-create-driver] welcome email failed:', e)
      welcomeEmail = { sent: false, reason: e instanceof Error ? e.message : String(e) }
    }

    return jsonResponse({ success: true, userId, linkedExisting, welcomeEmail })
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
