import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { jsonResponse } from '../_shared/cors.ts'
import { escapeHtml } from '../_shared/escapeHtml.ts'
import { serviceClient } from '../_shared/supabaseClients.ts'
import { emailLogo } from '../_shared/brand.ts'

// Called hourly by pg_cron (migration 20261005150000_abandoned_cart_reminders),
// never by the browser. Deployed with --no-verify-jwt because the cron job has
// no user JWT; the shared CRON_SECRET header is the authentication instead.

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const MAIL_FROM_DOMAIN = Deno.env.get('MAIL_FROM_DOMAIN') ?? '224clubhouse.co.za'
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? ''
const SITE_URL = 'https://224clubhouse.store'

interface CartLine {
  name?: string
  variant_label?: string | null
  price?: number
  quantity?: number
}

interface ClaimedCart {
  recipient_id: string
  recipient_email: string
  cart_items: CartLine[]
  opt_out_token: string
}

function formatZAR(cents: number): string {
  return `R${(cents / 100).toFixed(2)}`
}

/** Constant-time string compare, so the secret can't be guessed byte by byte. */
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const x = enc.encode(a)
  const y = enc.encode(b)
  if (x.length !== y.length) return false
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]
  return diff === 0
}

function reminderHtml(lines: CartLine[], optOutUrl: string): string {
  // Prices are the snapshot from when the cart was saved — labelled as such.
  // The real order is priced by place_cod_order at checkout.
  const rows = lines.slice(0, 20).map(line => {
    const name = line.variant_label ? `${line.name ?? ''} — ${line.variant_label}` : (line.name ?? '')
    const qty = Math.max(1, Number(line.quantity) || 1)
    const price = Number(line.price) || 0
    return `
      <tr>
        <td style="padding: 8px 0; color: #ffffff; border-bottom: 1px solid #222222;">${escapeHtml(name)}</td>
        <td style="padding: 8px 0; color: #888888; text-align: center; border-bottom: 1px solid #222222;">${escapeHtml(qty)}</td>
        <td style="padding: 8px 0; color: #C9A84C; text-align: right; border-bottom: 1px solid #222222;">${formatZAR(price * qty)}</td>
      </tr>`
  }).join('')

  return `<!DOCTYPE html>
<html>
<body style="margin:0; padding:0; background:#0a0a0a; font-family:'Inter',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a; padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
        <tr><td align="center" style="padding-bottom:24px;">${emailLogo(180)}</td></tr>
        <tr><td style="background:#111111; border:1px solid #222222; border-radius:12px; padding:28px;">
          <h1 style="font-family:Georgia, serif; color:#ffffff; font-size:24px; margin:0 0 12px;">You left something in your cart</h1>
          <p style="color:#cccccc; font-size:14px; line-height:1.6; margin:0 0 20px;">
            Your cart is saved and waiting. Pick up where you left off — delivery is free for members and on orders of R500 or more.
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px; margin-bottom:8px;">
            <tr>
              <th align="left" style="color:#888888; font-weight:normal; padding-bottom:6px;">Item</th>
              <th style="color:#888888; font-weight:normal; padding-bottom:6px;">Qty</th>
              <th align="right" style="color:#888888; font-weight:normal; padding-bottom:6px;">Price</th>
            </tr>
            ${rows}
          </table>
          <p style="color:#888888; font-size:12px; margin:0 0 24px;">Prices and stock are confirmed at checkout.</p>
          <table cellpadding="0" cellspacing="0" align="center"><tr><td style="background:#C9A84C; border-radius:8px;">
            <a href="${SITE_URL}/cart" style="display:inline-block; padding:14px 28px; color:#000000; font-weight:bold; text-decoration:none; text-transform:uppercase; letter-spacing:2px; font-size:13px;">Return to your cart</a>
          </td></tr></table>
        </td></tr>
        <tr><td align="center" style="padding-top:20px; color:#444444; font-size:11px; line-height:1.6;">
          224 Clubhouse · 224 Rondebult Road, Libradene, Boksburg · Not for persons under 21<br>
          <a href="${escapeHtml(optOutUrl)}" style="color:#888888;">Stop cart reminders</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

serve(async (req) => {
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
  const given = req.headers.get('x-cron-secret') ?? ''
  if (!CRON_SECRET || !safeEqual(given, CRON_SECRET)) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }
  if (!RESEND_API_KEY) return jsonResponse({ error: 'RESEND_API_KEY not set' }, 500)

  const admin = serviceClient()
  const { data, error } = await admin.rpc('claim_cart_reminders', { p_limit: 50 })
  if (error) return jsonResponse({ error: error.message }, 500)

  const carts = (data ?? []) as ClaimedCart[]
  const failed: string[] = []
  let sent = 0

  for (const cart of carts) {
    const optOutUrl = `${SITE_URL}/unsubscribe?cart=${encodeURIComponent(cart.opt_out_token)}`
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `224 Clubhouse <hello@${MAIL_FROM_DOMAIN}>`,
          to: cart.recipient_email,
          subject: 'Your 224 Clubhouse cart is waiting',
          html: reminderHtml(Array.isArray(cart.cart_items) ? cart.cart_items : [], optOutUrl),
          // No List-Unsubscribe-Post: /unsubscribe is a GET-only SPA page (same
          // reasoning as send-welcome-email).
          headers: { 'List-Unsubscribe': `<${optOutUrl}>` },
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      sent += 1
    } catch (e) {
      console.error('cart reminder failed', cart.recipient_id, e instanceof Error ? e.message : e)
      failed.push(cart.recipient_id)
    }
  }

  // Un-claim the failures so the next hourly run retries them.
  if (failed.length) {
    const { error: releaseError } = await admin.rpc('release_cart_reminders', { p_user_ids: failed })
    if (releaseError) console.error('release_cart_reminders failed', releaseError.message)
  }

  return jsonResponse({ claimed: carts.length, sent, failed: failed.length })
})
