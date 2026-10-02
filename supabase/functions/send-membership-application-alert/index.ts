import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { escapeHtml } from '../_shared/escapeHtml.ts'
import { callerClient, serviceClient } from '../_shared/supabaseClients.ts'

// Tells the club a membership application is waiting for approval. Invoked by
// the APPLICANT right after place_membership succeeds (fire-and-forget).

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const MAIL_FROM_DOMAIN = Deno.env.get('MAIL_FROM_DOMAIN') ?? '224clubhouse.co.za'
// Same secret the order alert uses. Unset = deliberate silent no-op.
const ADMIN_ALERT_EMAIL = Deno.env.get('ADMIN_ALERT_EMAIL') ?? ''
const SITE_URL = 'https://224clubhouse.store'

// Only alert for fresh applications, so a caller can't re-invoke this to spam
// the club's inbox with an old row.
const MAX_AGE_MS = 10 * 60 * 1000

function formatZAR(cents: number): string {
  return `R${(cents / 100).toFixed(2)}`
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { membershipId } = await req.json()
    if (!membershipId) return jsonResponse({ error: 'membershipId is required' }, 400)

    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader) return jsonResponse({ error: 'Not authenticated' }, 401)
    // getUser() needs the JWT explicitly — an edge function has no persisted
    // session, so the no-argument form always comes back empty.
    const jwt = authHeader.replace(/^Bearer\s+/i, '')
    const { data: { user } } = await callerClient(authHeader).auth.getUser(jwt)
    if (!user) return jsonResponse({ error: 'Not authenticated' }, 401)

    const admin = serviceClient()
    const { data: m, error } = await admin
      .from('memberships')
      .select('user_id, full_name, email, phone, id_number, date_of_birth, tier, tier_id, amount, status, created_at')
      .eq('id', membershipId)
      .maybeSingle()
    // "Not yours" and "not found" look the same to the caller.
    if (error || !m || m.user_id !== user.id) return jsonResponse({ error: 'Membership not found' }, 404)
    if (m.status !== 'pending' || Date.now() - new Date(m.created_at).getTime() > MAX_AGE_MS) {
      return jsonResponse({ skipped: true })
    }

    const to = ADMIN_ALERT_EMAIL.split(',').map(a => a.trim()).filter(Boolean)
    if (to.length === 0 || !RESEND_API_KEY) return jsonResponse({ skipped: true })

    let tierName: string = m.tier
    const { data: tier } = m.tier_id
      ? await admin.from('membership_tiers').select('name').eq('id', m.tier_id).maybeSingle()
      : await admin.from('membership_tiers').select('name').eq('slug', m.tier).maybeSingle()
    if (tier?.name) tierName = tier.name

    const row = (label: string, value: string) =>
      `<tr><td style="padding:6px 12px 6px 0;color:#888;font-size:13px;">${label}</td><td style="padding:6px 0;color:#fff;font-size:13px;">${escapeHtml(value)}</td></tr>`

    const html = `
<!DOCTYPE html>
<html><body style="margin:0;background:#0a0a0a;font-family:Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    <p style="font-family:Georgia,serif;color:#C9A84C;font-size:28px;font-weight:bold;margin:0 0 4px;">224</p>
    <h1 style="color:#fff;font-size:20px;margin:0 0 20px;">New membership application</h1>
    <table style="border-collapse:collapse;">
      ${row('Name', m.full_name)}
      ${row('Email', m.email)}
      ${row('Phone', m.phone)}
      ${row('ID / Passport', m.id_number ?? '—')}
      ${row('Date of birth', m.date_of_birth)}
      ${row('Membership', tierName)}
      ${row('Amount due', formatZAR(m.amount))}
    </table>
    <p style="color:#888;font-size:13px;margin:24px 0;">
      The applicant pays by EFT or with their next delivery. Approve it once payment is received.
    </p>
    <a href="${SITE_URL}/admin/memberships" style="display:inline-block;background:#C9A84C;color:#000;text-decoration:none;font-weight:bold;padding:12px 24px;border-radius:6px;">Review in admin</a>
  </div>
</body></html>`

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `224 Clubhouse <hello@${MAIL_FROM_DOMAIN}>`,
        to,
        subject: `New membership application — ${m.full_name} (${tierName})`,
        html,
      }),
    })
    if (!res.ok) return jsonResponse({ error: await res.text() }, 502)
    return jsonResponse({ sent: true })
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500)
  }
})
