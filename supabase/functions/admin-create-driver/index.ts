import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { callerIsAdmin, serviceClient } from '../_shared/supabaseClients.ts'

// Admin creates a driver login (migration 20261007150000_driver_portal).
// Creating an auth user needs the service role, so this runs server-side and
// only for a caller whose JWT passes is_admin().
//
// If the email already has an account, it is linked as a driver and its
// existing password is left alone (the response says so).

interface Payload {
  email?: string
  password?: string
  fullName?: string
  phone?: string
}

async function findUserIdByEmail(email: string): Promise<string | null> {
  const admin = serviceClient()
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    const hit = data.users.find(u => (u.email ?? '').toLowerCase() === email)
    if (hit) return hit.id
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

    const body: Payload = await req.json()
    const email = (body.email ?? '').trim().toLowerCase()
    const password = body.password ?? ''
    const fullName = (body.fullName ?? '').trim()
    const phone = (body.phone ?? '').trim() || null

    if (!/^\S+@\S+\.\S+$/.test(email)) return jsonResponse({ error: 'Enter a valid email address' }, 400)
    if (!fullName) return jsonResponse({ error: "Enter the driver's name" }, 400)

    const admin = serviceClient()
    let userId = await findUserIdByEmail(email)
    let linkedExisting = false

    if (userId) {
      linkedExisting = true
    } else {
      if (password.length < 8) return jsonResponse({ error: 'Password must be at least 8 characters' }, 400)
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true, // the admin vouches for the address; no confirmation email
        user_metadata: { full_name: fullName, role: 'driver' },
      })
      if (error || !data.user) return jsonResponse({ error: error?.message ?? 'Could not create the login' }, 400)
      userId = data.user.id
    }

    const { error: rowError } = await admin
      .from('drivers')
      .upsert({ user_id: userId, full_name: fullName, phone, active: true }, { onConflict: 'user_id' })
    if (rowError) return jsonResponse({ error: rowError.message }, 500)

    return jsonResponse({ success: true, userId, linkedExisting })
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
