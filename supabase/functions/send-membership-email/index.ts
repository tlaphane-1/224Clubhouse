import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { escapeHtml } from '../_shared/escapeHtml.ts'
import { callerIsAdmin, callerTenant, serviceClient } from '../_shared/supabaseClients.ts'
import { darkFooter, emailLogo } from '../_shared/brand.ts'
import { sendStoreMail } from '../_shared/mail.ts'
import { DEFAULT_STORE, storeFor } from '../_shared/stores.ts'

// Branded and sent as the store the membership belongs to (memberships.tenant).

// The ONLY thing the client may supply. Recipient, name, tier and expiry are
// read from the membership row: with a caller-supplied recipient, anyone
// holding the (public) anon key could send branded mail from the club's
// verified domain to any address they chose.
interface MembershipEmailPayload {
  membershipId: string
}

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
      .select('full_name, email, tier, tier_id, expires_at, tenant')
      .eq('id', membershipId)
      .single()

    if (membershipError || !membership) return jsonResponse({ error: 'Membership not found' }, 404)
    // is_admin() only proves the caller administers THEIR store.
    if ((await callerTenant(authHeader)) !== (membership.tenant || DEFAULT_STORE)) {
      return jsonResponse({ error: 'Not authorized' }, 403)
    }
    const brand = storeFor(membership.tenant)
    if (!brand) return jsonResponse({ error: `No email settings for store ${membership.tenant}` }, 500)

    // Display name for the tier. Looked up separately rather than embedded so
    // the query can't break on PostgREST relationship ambiguity; legacy rows
    // have no tier_id, so fall back to matching the text tier against the slug,
    // then to the raw slug itself.
    let tierName: string = membership.tier
    const { data: tier } = membership.tier_id
      ? await admin.from('membership_tiers').select('name').eq('id', membership.tier_id).maybeSingle()
      : await admin.from('membership_tiers').select('name').eq('slug', membership.tier).eq('tenant', brand.slug).maybeSingle()
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
      ${emailLogo(brand, 200)}
    </div>

    <!-- Divider -->
    <div style="width:48px; height:1px; background:${brand.gold}; margin:0 auto 40px;"></div>

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
        <div style="color:${brand.gold}; font-family:Georgia,serif; font-size:22px; font-weight:700; letter-spacing:1px;">${escapeHtml(tierName)}</div>
      </div>

      <table style="width:100%; border-collapse:collapse;">
        <tr>
          <td style="padding: 8px 0; color: #888888; border-bottom: 1px solid #222222;">Status</td>
          <td style="padding: 8px 0; color: #ffffff; text-align: right; border-bottom: 1px solid #222222;">Active</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #888888;">Valid until</td>
          <td style="padding: 8px 0; color: ${brand.gold}; text-align: right; font-weight:700;">${formatValidUntil(expiresAt)}</td>
        </tr>
      </table>
    </div>

    <!-- What to bring -->
    <div style="background:#111111; border:1px solid #222222; border-radius:12px; padding:20px; margin-bottom:32px; text-align:center;">
      <div style="color:${brand.gold}; font-size:11px; text-transform:uppercase; letter-spacing:2px; margin-bottom:6px;">What to Bring</div>
      <div style="color:#ffffff; font-size:15px; font-weight:600;">Your ID — we check it at the door</div>
      <div style="color:#888888; font-size:12px; margin-top:6px;">Membership is personal and non-transferable.</div>
    </div>

    <!-- Visit -->
    <div style="text-align:center; margin-bottom:32px;">
      <a href="${brand.siteUrl}/membership"
         style="display:inline-block; background:${brand.gold}; color:#0a0a0a; text-decoration:none; padding:14px 32px; border-radius:8px; font-size:13px; font-weight:700; text-transform:uppercase; letter-spacing:2px;">
        View member benefits
      </a>
    </div>

    <!-- Footer -->${darkFooter(brand)}

  </div>
</body>
</html>`

    const sent = await sendStoreMail(brand, {
      sender: 'hello',
      to: memberEmail,
      subject: `Your ${brand.name} membership is confirmed 🌿`,
      html,
    })
    if (!sent.sent) throw new Error(sent.reason)

    return jsonResponse({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return jsonResponse({ error: message }, 500)
  }
})
