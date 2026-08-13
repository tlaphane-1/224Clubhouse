import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { escapeHtml } from '../_shared/escapeHtml.ts'
import { callerIsAdmin, serviceClient } from '../_shared/supabaseClients.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
// Interim: sends go out from a domain already verified on the Resend account until
// 224clubhouse.co.za is verified there. Unset MAIL_FROM_DOMAIN to revert to the default.
const MAIL_FROM_DOMAIN = Deno.env.get('MAIL_FROM_DOMAIN') ?? '224clubhouse.co.za'

// The ONLY thing the client may supply. Recipient, name, tier and expiry are
// read from the membership row: with a caller-supplied recipient, anyone
// holding the (public) anon key could send branded mail from the club's
// verified domain to any address they chose.
interface MembershipEmailPayload {
  membershipId: string
}

const SITE_URL = 'https://224clubhouse.web.app'

function formatValidUntil(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('en-ZA', { dateStyle: 'long' }).format(d)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const payload: MembershipEmailPayload = await req.json()
    const { membershipId } = payload
    if (!membershipId) return jsonResponse({ error: 'membershipId is required' }, 400)

    // --- Authorization: admin-triggered, so the caller must BE an admin ---
    // Same server-side boundary the RLS policies use: is_admin() evaluated
    // under the caller's own JWT, never a client-side claim.
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader) return jsonResponse({ error: 'Not authenticated' }, 401)
    if (!(await callerIsAdmin(authHeader))) return jsonResponse({ error: 'Not authorized' }, 403)

    // --- Facts come from the DB, never from the payload ------------------
    const admin = serviceClient()
    const { data: membership, error: membershipError } = await admin
      .from('memberships')
      .select('full_name, email, tier, tier_id, expires_at')
      .eq('id', membershipId)
      .single()

    if (membershipError || !membership) return jsonResponse({ error: 'Membership not found' }, 404)

    // Display name for the tier. Looked up separately rather than embedded so
    // the query can't break on PostgREST relationship ambiguity; legacy rows
    // have no tier_id, so fall back to matching the text tier against the slug,
    // then to the raw slug itself.
    let tierName: string = membership.tier
    const { data: tier } = membership.tier_id
      ? await admin.from('membership_tiers').select('name').eq('id', membership.tier_id).maybeSingle()
      : await admin.from('membership_tiers').select('name').eq('slug', membership.tier).maybeSingle()
    if (tier?.name) tierName = tier.name

    const memberName: string = membership.full_name
    const memberEmail: string = membership.email
    const expiresAt: string | undefined = membership.expires_at ?? undefined

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0; padding:0; background-color:#0a0a0a; font-family:'Inter',Arial,sans-serif;">
  <div style="max-width:600px; margin:0 auto; padding:40px 20px;">

    <!-- Logo -->
    <div style="text-align:center; margin-bottom:40px;">
      <div style="font-size:48px; font-weight:900; color:#C9A84C; letter-spacing:8px; font-family:Georgia,serif;">224</div>
      <div style="color:#ffffff; font-size:9px; letter-spacing:6px; text-transform:uppercase; margin-top:4px;">Clubhouse</div>
    </div>

    <!-- Divider -->
    <div style="width:48px; height:1px; background:#C9A84C; margin:0 auto 40px;"></div>

    <!-- Heading -->
    <h1 style="color:#ffffff; font-family:Georgia,serif; font-size:28px; text-align:center; margin-bottom:8px; font-weight:600;">
      Your membership is confirmed 🌿
    </h1>
    <p style="color:#888888; text-align:center; margin-bottom:40px; font-size:15px;">
      Welcome, ${escapeHtml(memberName)}! Your application has been approved and your membership is now active.
    </p>

    <!-- Membership Card -->
    <div style="background:#111111; border:1px solid #222222; border-radius:12px; padding:28px; margin-bottom:24px;">

      <div style="margin-bottom:24px; padding-bottom:16px; border-bottom:1px solid #222222; text-align:center;">
        <div style="color:#888888; font-size:11px; text-transform:uppercase; letter-spacing:2px; margin-bottom:6px;">Your Membership</div>
        <div style="color:#C9A84C; font-family:Georgia,serif; font-size:22px; font-weight:700; letter-spacing:1px;">${escapeHtml(tierName)}</div>
      </div>

      <table style="width:100%; border-collapse:collapse;">
        <tr>
          <td style="padding: 8px 0; color: #888888; border-bottom: 1px solid #222222;">Status</td>
          <td style="padding: 8px 0; color: #ffffff; text-align: right; border-bottom: 1px solid #222222;">Active</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #888888;">Valid until</td>
          <td style="padding: 8px 0; color: #C9A84C; text-align: right; font-weight:700;">${formatValidUntil(expiresAt)}</td>
        </tr>
      </table>
    </div>

    <!-- What to bring -->
    <div style="background:#111111; border:1px solid #222222; border-radius:12px; padding:20px; margin-bottom:32px; text-align:center;">
      <div style="color:#C9A84C; font-size:11px; text-transform:uppercase; letter-spacing:2px; margin-bottom:6px;">What to Bring</div>
      <div style="color:#ffffff; font-size:15px; font-weight:600;">Your ID — we check it at the door</div>
      <div style="color:#888888; font-size:12px; margin-top:6px;">Membership is personal and non-transferable.</div>
    </div>

    <!-- Visit -->
    <div style="text-align:center; margin-bottom:32px;">
      <a href="${SITE_URL}/membership"
         style="display:inline-block; background:#C9A84C; color:#0a0a0a; text-decoration:none; padding:14px 32px; border-radius:8px; font-size:13px; font-weight:700; text-transform:uppercase; letter-spacing:2px;">
        View member benefits
      </a>
    </div>

    <!-- Footer -->
    <div style="text-align:center; border-top:1px solid #222222; padding-top:28px;">
      <div style="color:#C9A84C; font-size:20px; font-family:Georgia,serif; font-weight:700; letter-spacing:4px; margin-bottom:4px;">224</div>
      <div style="color:#888888; font-size:9px; letter-spacing:4px; text-transform:uppercase; margin-bottom:16px;">Clubhouse</div>
      <p style="color:#888888; font-size:12px; margin-bottom:4px;">224 Rondebult Ave, Libradene, Boksburg, 1459</p>
      <p style="color:#888888; font-size:12px; margin-bottom:16px;">Mon–Sun 09:00–19:00</p>
      <div style="display:flex; justify-content:center; gap:16px; margin-bottom:16px;">
        <a href="https://www.instagram.com/224clubhouse" style="color:#C9A84C; text-decoration:none; font-size:12px;">Instagram</a>
        <span style="color:#333;">|</span>
        <a href="https://www.facebook.com/224clubhouse" style="color:#C9A84C; text-decoration:none; font-size:12px;">Facebook</a>
      </div>
      <p style="color:#444; font-size:11px;">🔞 Not for persons under 21</p>
    </div>

  </div>
</body>
</html>`

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `224 Clubhouse <hello@${MAIL_FROM_DOMAIN}>`,
        to: memberEmail,
        subject: 'Your 224 Clubhouse membership is confirmed 🌿',
        html,
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(err)
    }

    return jsonResponse({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return jsonResponse({ error: message }, 500)
  }
})
