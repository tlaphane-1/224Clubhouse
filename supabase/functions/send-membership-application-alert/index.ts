import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { escapeHtml } from '../_shared/escapeHtml.ts'
import { callerClient, serviceClient } from '../_shared/supabaseClients.ts'
import { emailLogo } from '../_shared/brand.ts'
import { notifyTelegram, tg } from '../_shared/telegram.ts'
import { alertStore } from '../_shared/storeAlerts.ts'
import { sendStoreMail } from '../_shared/mail.ts'
import { DEFAULT_STORE } from '../_shared/stores.ts'

// Tells the club a membership application is waiting for approval. Invoked by
// the APPLICANT right after place_membership succeeds (fire-and-forget).

// Recipients are the store's owner alert addresses (_shared/storeAlerts.ts);
// the email is branded and sent as that store (_shared/mail.ts).
// None set = deliberate silent no-op.

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
      .select('user_id, full_name, email, phone, id_number, date_of_birth, tier, tier_id, amount, status, created_at, tenant')
      .eq('id', membershipId)
      .maybeSingle()
    // "Not yours" and "not found" look the same to the caller.
    if (error || !m || m.user_id !== user.id) return jsonResponse({ error: 'Membership not found' }, 404)
    if (m.status !== 'pending' || Date.now() - new Date(m.created_at).getTime() > MAX_AGE_MS) {
      return jsonResponse({ skipped: true })
    }

    let tierName: string = m.tier
    const { data: tier } = m.tier_id
      ? await admin.from('membership_tiers').select('name').eq('id', m.tier_id).maybeSingle()
      : await admin.from('membership_tiers').select('name').eq('slug', m.tier).eq('tenant', m.tenant || DEFAULT_STORE).maybeSingle()
    if (tier?.name) tierName = tier.name

    const store = await alertStore(m.tenant)
    // Telegram: no ID number or date of birth in a group chat (POPIA).
    await notifyTelegram('memberships',
      `👑 <b>Membership application</b> — ${tg(tierName)}\n${tg(m.full_name)} · ${tg(m.phone ?? '')}`,
      { text: 'Open memberships', url: `${store.siteUrl}/admin/memberships` }, store.tenant)

    const to = store.to
    const brand = store.brand
    if (to.length === 0 || !brand) return jsonResponse({ skipped: true })

    const row = (label: string, value: string) =>
      `<tr><td style="padding:6px 12px 6px 0;color:#888;font-size:13px;">${label}</td><td style="padding:6px 0;color:#fff;font-size:13px;">${escapeHtml(value)}</td></tr>`

    const html = `
<!DOCTYPE html>
<html><body style="margin:0;background:#0a0a0a;font-family:Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    <p style="margin:0 0 12px;">${emailLogo(brand, 140)}</p>
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
    <a href="${store.siteUrl}/admin/memberships" style="display:inline-block;background:${brand.gold};color:#000;text-decoration:none;font-weight:bold;padding:12px 24px;border-radius:6px;">Review in admin</a>
  </div>
</body></html>`

    try {
      const sent = await sendStoreMail(brand, {
        sender: 'hello',
        to,
        subject: `New membership application — ${m.full_name} (${tierName})`,
        html,
      })
      if (!sent.sent) return jsonResponse({ skipped: true, reason: sent.reason })
    } catch (e) {
      return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 502)
    }
    return jsonResponse({ sent: true })
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500)
  }
})
