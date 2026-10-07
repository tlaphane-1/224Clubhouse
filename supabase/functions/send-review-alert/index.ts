import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { escapeHtml } from '../_shared/escapeHtml.ts'
import { callerClient, serviceClient } from '../_shared/supabaseClients.ts'
import { notifyTelegram, tg, SITE_URL as TG_SITE } from '../_shared/telegram.ts'

// "A review is waiting" alert to the club (migration 20261005160000 reviews).
// Called by the browser right after submit_product_review. Only { productId }
// comes from the client: the caller must be signed in and must have a PENDING
// review on that product — so nobody can use this to spam the club inbox.

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const MAIL_FROM_DOMAIN = Deno.env.get('MAIL_FROM_DOMAIN') ?? '224clubhouse.co.za'
const ADMIN_ALERT_EMAIL = Deno.env.get('ADMIN_ALERT_EMAIL') ?? ''
const SITE_URL = 'https://224clubhouse.store'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { productId } = await req.json()
    if (!productId) return jsonResponse({ error: 'productId is required' }, 400)

    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader) return jsonResponse({ error: 'Not authenticated' }, 401)
    const jwt = authHeader.replace(/^Bearer\s+/i, '')
    const { data: userData } = await callerClient(authHeader).auth.getUser(jwt)
    const caller = userData?.user
    if (!caller) return jsonResponse({ error: 'Not authenticated' }, 401)

    const admin = serviceClient()
    const { data: review, error } = await admin
      .from('product_reviews')
      .select('rating, body, display_name, status, products(name)')
      .eq('product_id', productId)
      .eq('user_id', caller.id)
      .maybeSingle()
    if (error) return jsonResponse({ error: error.message }, 500)
    if (!review || review.status !== 'pending') return jsonResponse({ error: 'No pending review' }, 404)

    {
      // deno-lint-ignore no-explicit-any
      const productName = (review as any).products?.name ?? 'a product'
      await notifyTelegram('reviews',
        `⭐ <b>Review waiting</b> — ${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)} for ${tg(productName)}\n`
        + `“${tg(String(review.body ?? '').slice(0, 300))}” — ${tg(review.display_name)}`,
        { text: 'Moderate', url: `${TG_SITE}/admin/reviews` })
    }

    const to = ADMIN_ALERT_EMAIL.split(',').map((a: string) => a.trim()).filter(Boolean)
    if (to.length === 0) return jsonResponse({ success: false, reason: 'ADMIN_ALERT_EMAIL not set' })
    if (!RESEND_API_KEY) return jsonResponse({ error: 'RESEND_API_KEY not set' }, 500)

    // deno-lint-ignore no-explicit-any
    const productName: string = (review as any).products?.name ?? 'a product'
    const stars = '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating)

    // Internal alert: same plain, phone-readable style as the new-order alert.
    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0; padding:0; background:#f4f4f4; font-family:Arial,Helvetica,sans-serif; color:#111111;">
  <div style="max-width:560px; margin:0 auto; padding:20px 12px;">
    <div style="background:#ffffff; border:1px solid #e2e2e2; border-radius:8px; padding:20px;">
      <div style="font-size:12px; letter-spacing:2px; text-transform:uppercase; color:#777777;">Review waiting for approval</div>
      <div style="font-size:20px; font-weight:700; margin:6px 0 2px;">${escapeHtml(productName)}</div>
      <div style="font-size:20px; color:#C9A84C;">${stars}</div>
      <div style="height:2px; background:#C9A84C; margin:16px 0;"></div>
      <div style="font-size:14px; color:#333333; white-space:pre-line;">${review.body ? escapeHtml(review.body) : '<em>Rating only, no text.</em>'}</div>
      <div style="font-size:13px; color:#666666; margin-top:8px;">— ${escapeHtml(review.display_name)}</div>
      <div style="font-size:12px; color:#8a6d1a; margin-top:16px;">Publish only if it has no health or medical claims and no personal details.</div>
      <div style="margin-top:20px;">
        <a href="${SITE_URL}/admin/reviews"
           style="display:inline-block; background:#111111; color:#ffffff; text-decoration:none; padding:12px 22px; border-radius:6px; font-size:14px; font-weight:700;">
          Review it
        </a>
      </div>
      <div style="margin-top:20px; padding-top:14px; border-top:1px solid #eeeeee; font-size:11px; color:#999999;">
        224 Clubhouse &middot; internal review alert
      </div>
    </div>
  </div>
</body>
</html>`

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `224 Clubhouse <orders@${MAIL_FROM_DOMAIN}>`,
        to,
        subject: `New review to approve: ${productName} (${review.rating}★)`,
        html,
      }),
    })
    if (!res.ok) throw new Error(await res.text())
    return jsonResponse({ success: true })
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
