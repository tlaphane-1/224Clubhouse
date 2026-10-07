import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { escapeHtml } from '../_shared/escapeHtml.ts'
import { callerClient, callerIsAdmin, serviceClient } from '../_shared/supabaseClients.ts'
import { emailLogo } from '../_shared/brand.ts'

// EFT payment emails (migration 20261007120000_eft_payment_verification):
//   kind 'proof'    — the CUSTOMER uploaded proof of payment → alert the club.
//                     Caller must own the order and the proof must be on it.
//   kind 'received' — an ADMIN confirmed the payment → tell the customer.
//                     Caller must be an admin and the order must be paid.
// Only { orderId, kind } come from the client; every fact is read from the row.

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const MAIL_FROM_DOMAIN = Deno.env.get('MAIL_FROM_DOMAIN') ?? '224clubhouse.co.za'
const ADMIN_ALERT_EMAIL = Deno.env.get('ADMIN_ALERT_EMAIL') ?? ''
const SITE_URL = 'https://224clubhouse.store'

function formatZAR(cents: number): string {
  return `R${(cents / 100).toFixed(2)}`
}

function shell(heading: string, body: string, ctaUrl: string, ctaLabel: string): string {
  return `<!DOCTYPE html>
<html>
<body style="margin:0; padding:0; background:#0a0a0a; font-family:'Inter',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a; padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
        <tr><td align="center" style="padding-bottom:24px;">${emailLogo(180)}</td></tr>
        <tr><td style="background:#111111; border:1px solid #222222; border-radius:12px; padding:28px;">
          <h1 style="font-family:Georgia, serif; color:#ffffff; font-size:24px; margin:0 0 12px;">${heading}</h1>
          <div style="color:#cccccc; font-size:14px; line-height:1.6; margin:0 0 24px;">${body}</div>
          <table cellpadding="0" cellspacing="0" align="center"><tr><td style="background:#C9A84C; border-radius:8px;">
            <a href="${ctaUrl}" style="display:inline-block; padding:14px 28px; color:#000000; font-weight:bold; text-decoration:none; text-transform:uppercase; letter-spacing:2px; font-size:13px;">${ctaLabel}</a>
          </td></tr></table>
        </td></tr>
        <tr><td align="center" style="padding-top:20px; color:#444444; font-size:11px;">
          224 Clubhouse · 224 Rondebult Road, Libradene, Boksburg · Not for persons under 21
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

async function send(to: string[], subject: string, html: string): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `224 Clubhouse <orders@${MAIL_FROM_DOMAIN}>`, to, subject, html }),
  })
  if (!res.ok) throw new Error(await res.text())
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { orderId, kind } = await req.json()
    if (!orderId || (kind !== 'proof' && kind !== 'received')) {
      return jsonResponse({ error: 'orderId and kind (proof | received) are required' }, 400)
    }
    if (!RESEND_API_KEY) return jsonResponse({ error: 'RESEND_API_KEY not set' }, 500)

    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader) return jsonResponse({ error: 'Not authenticated' }, 401)

    const { data: order, error } = await serviceClient()
      .from('orders')
      .select('order_number, customer_name, customer_email, total, payment_method, user_id, ' +
              'paid_at, paid_amount_cents, payment_proof_uploaded_at')
      .eq('id', orderId)
      .single()
    if (error || !order) return jsonResponse({ error: 'Order not found' }, 404)
    if (order.payment_method !== 'eft') return jsonResponse({ error: 'Not an EFT order' }, 400)

    if (kind === 'proof') {
      const jwt = authHeader.replace(/^Bearer\s+/i, '')
      const { data: userData } = await callerClient(authHeader).auth.getUser(jwt)
      if (!userData?.user || userData.user.id !== order.user_id) {
        return jsonResponse({ error: 'Not authorized' }, 403)
      }
      if (!order.payment_proof_uploaded_at) return jsonResponse({ error: 'No proof on this order' }, 400)

      const to = ADMIN_ALERT_EMAIL.split(',').map((a: string) => a.trim()).filter(Boolean)
      if (to.length === 0) return jsonResponse({ success: false, reason: 'ADMIN_ALERT_EMAIL not set' })
      await send(
        to,
        `Proof of payment: ${order.order_number} — ${formatZAR(order.total)}`,
        shell(
          'Proof of payment uploaded',
          `${escapeHtml(order.customer_name)} uploaded proof of an EFT payment for order
           <strong style="color:#ffffff;">${escapeHtml(order.order_number)}</strong>
           (${formatZAR(order.total)}).<br><br>
           Check that the money has reflected in the FNB account, then mark the payment received.
           A proof of payment alone is not confirmation — they can be faked.`,
          `${SITE_URL}/admin/orders`,
          'Open orders',
        ),
      )
      return jsonResponse({ success: true })
    }

    // kind === 'received'
    if (!(await callerIsAdmin(authHeader))) return jsonResponse({ error: 'Not authorized' }, 403)
    if (!order.paid_at) return jsonResponse({ error: 'Payment not marked received' }, 400)

    const firstName = (order.customer_name ?? '').split(' ')[0] || 'there'
    await send(
      [order.customer_email],
      `Payment received for order ${order.order_number}`,
      shell(
        'Payment received ✅',
        `Thanks, ${escapeHtml(firstName)} — we've received your EFT payment of
         <strong style="color:#C9A84C;">${formatZAR(order.paid_amount_cents ?? order.total)}</strong>
         for order <strong style="color:#ffffff;">${escapeHtml(order.order_number)}</strong>.
         We'll start preparing it now and let you know when it's on its way.`,
        `${SITE_URL}/orders`,
        'View your order',
      ),
    )
    return jsonResponse({ success: true })
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
