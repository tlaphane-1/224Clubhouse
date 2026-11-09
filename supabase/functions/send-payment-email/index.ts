import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { escapeHtml } from '../_shared/escapeHtml.ts'
import { callerClient, callerIsAdmin, callerTenant, serviceClient } from '../_shared/supabaseClients.ts'
import { ageLine, emailLogo } from '../_shared/brand.ts'
import { notifyTelegram, tg } from '../_shared/telegram.ts'
import { alertStore } from '../_shared/storeAlerts.ts'
import { sendStoreMail } from '../_shared/mail.ts'
import type { Store } from '../_shared/stores.ts'

// EFT payment emails (migration 20261007120000_eft_payment_verification):
//   kind 'proof'    — the CUSTOMER uploaded proof of payment → alert the club.
//                     Caller must own the order and the proof must be on it.
//   kind 'received' — an ADMIN confirmed the payment → tell the customer.
//                     Caller must be an admin and the order must be paid.
// Only { orderId, kind } come from the client; every fact is read from the row.
// Both emails are branded and sent as the store the order belongs to.

function formatZAR(cents: number): string {
  return `R${(cents / 100).toFixed(2)}`
}

function shell(brand: Store, heading: string, body: string, ctaUrl: string, ctaLabel: string): string {
  return `<!DOCTYPE html>
<html>
<body style="margin:0; padding:0; background:#0a0a0a; font-family:'Inter',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a; padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
        <tr><td align="center" style="padding-bottom:24px;">${emailLogo(brand, 180)}</td></tr>
        <tr><td style="background:#111111; border:1px solid #222222; border-radius:12px; padding:28px;">
          <h1 style="font-family:Georgia, serif; color:#ffffff; font-size:24px; margin:0 0 12px;">${heading}</h1>
          <div style="color:#cccccc; font-size:14px; line-height:1.6; margin:0 0 24px;">${body}</div>
          <table cellpadding="0" cellspacing="0" align="center"><tr><td style="background:${brand.gold}; border-radius:8px;">
            <a href="${ctaUrl}" style="display:inline-block; padding:14px 28px; color:#000000; font-weight:bold; text-decoration:none; text-transform:uppercase; letter-spacing:2px; font-size:13px;">${ctaLabel}</a>
          </td></tr></table>
        </td></tr>
        <tr><td align="center" style="padding-top:20px; color:#444444; font-size:11px;">
          ${escapeHtml(brand.name)} · ${escapeHtml(shortAddress(brand))} · ${ageLine(brand).replace(/^🔞 /, '')}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

// Street, suburb and city, as the compact footer has always shown them.
function shortAddress(brand: Store): string {
  return brand.address.split(', ').slice(0, 3).join(', ')
}

async function send(brand: Store, to: string[], subject: string, html: string): Promise<void> {
  const sent = await sendStoreMail(brand, { sender: 'orders', to, subject, html })
  if (!sent.sent) throw new Error(sent.reason)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { orderId, kind } = await req.json()
    if (!orderId || (kind !== 'proof' && kind !== 'received')) {
      return jsonResponse({ error: 'orderId and kind (proof | received) are required' }, 400)
    }

    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader) return jsonResponse({ error: 'Not authenticated' }, 401)

    const { data: order, error } = await serviceClient()
      .from('orders')
      .select('order_number, customer_name, customer_email, total, payment_method, user_id, ' +
              'paid_at, paid_amount_cents, payment_proof_uploaded_at, tenant')
      .eq('id', orderId)
      .single()
    if (error || !order) return jsonResponse({ error: 'Order not found' }, 404)
    if (order.payment_method !== 'eft') return jsonResponse({ error: 'Not an EFT order' }, 400)

    // The store's own owner alert recipients and sender, never by default 224's.
    const store = await alertStore(order.tenant)
    const brand = store.brand
    if (!brand) return jsonResponse({ error: `No email settings for store ${store.tenant}` }, 500)
    const bank = brand.bankName ?? 'the bank account'

    if (kind === 'proof') {
      const jwt = authHeader.replace(/^Bearer\s+/i, '')
      const { data: userData } = await callerClient(authHeader).auth.getUser(jwt)
      if (!userData?.user || userData.user.id !== order.user_id) {
        return jsonResponse({ error: 'Not authorized' }, 403)
      }
      if (!order.payment_proof_uploaded_at) return jsonResponse({ error: 'No proof on this order' }, 400)

      const to = store.to
      await notifyTelegram('eft',
        `🧾 <b>Proof of payment</b> for ${tg(order.order_number)} — ${tg(formatZAR(order.total))}\n`
        + `${tg(order.customer_name)}. Check ${tg(bank)} for the reference <b>${tg(order.customer_name)}</b> before marking it paid.`,
        { text: 'EFT to check', url: `${store.siteUrl}/admin/orders?filter=eft` }, store.tenant)
      if (to.length === 0) return jsonResponse({ success: false, reason: `no alert email set for ${store.tenant}` })
      await send(
        brand,
        to,
        `Proof of payment: ${order.order_number} — ${formatZAR(order.total)}`,
        shell(
          brand,
          'Proof of payment uploaded',
          `${escapeHtml(order.customer_name)} uploaded proof of an EFT payment for order
           <strong style="color:#ffffff;">${escapeHtml(order.order_number)}</strong>
           (${formatZAR(order.total)}).<br><br>
           Check that the money has reflected in the ${escapeHtml(bank === 'the bank account' ? 'bank' : bank)} account, then mark the payment received.
           A proof of payment alone is not confirmation — they can be faked.`,
          `${store.siteUrl}/admin/orders`,
          'Open orders',
        ),
      )
      return jsonResponse({ success: true })
    }

    // kind === 'received'
    // is_admin() only proves the caller administers THEIR store.
    if (!(await callerIsAdmin(authHeader)) || (await callerTenant(authHeader)) !== store.tenant) {
      return jsonResponse({ error: 'Not authorized' }, 403)
    }
    if (!order.paid_at) return jsonResponse({ error: 'Payment not marked received' }, 400)

    const firstName = (order.customer_name ?? '').split(' ')[0] || 'there'
    await send(
      brand,
      [order.customer_email],
      `Payment received for order ${order.order_number}`,
      shell(
        brand,
        'Payment received ✅',
        `Thanks, ${escapeHtml(firstName)} — we've received your EFT payment of
         <strong style="color:${brand.gold};">${formatZAR(order.paid_amount_cents ?? order.total)}</strong>
         for order <strong style="color:#ffffff;">${escapeHtml(order.order_number)}</strong>.
         We'll start preparing it now and let you know when it's on its way.`,
        `${brand.siteUrl}/orders`,
        'View your order',
      ),
    )
    return jsonResponse({ success: true })
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
