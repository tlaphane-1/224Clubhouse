import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { escapeHtml } from '../_shared/escapeHtml.ts'
import { callerClient, callerIsAdmin, serviceClient } from '../_shared/supabaseClients.ts'
import { emailLogo } from '../_shared/brand.ts'
import { notifyTelegram, tg, SITE_URL as TG_SITE } from '../_shared/telegram.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
// Interim: sends go out from a domain already verified on the Resend account until
// 224clubhouse.co.za is verified there. Unset MAIL_FROM_DOMAIN to revert to the default.
const MAIL_FROM_DOMAIN = Deno.env.get('MAIL_FROM_DOMAIN') ?? '224clubhouse.co.za'

// The ONLY thing the client may supply. Recipient, name and status are read
// from the order row: with a caller-supplied recipient, anyone holding the
// (public) anon key could send branded mail from the club's verified domain.
interface StatusEmailPayload {
  orderId: string
  // 'nearby': the one-off "driver is less than 1 km away" email, sent by the
  // driver portal when driver_update_location reports the order as nearby.
  kind?: 'status' | 'nearby'
}

// Not a status, so it lives outside STATUS_COPY. Only sent while the order is
// actually out for delivery.
const NEARBY_COPY = {
  subject: 'Your 224 Clubhouse driver is nearby 🚚',
  heading: 'Your Driver Is Nearby 🚚',
  message: '{name}, your driver is less than a kilometre away — please be ready to receive your order.',
}

const SITE_URL = 'https://224clubhouse.store'

// Per-status subject + copy. 'pending' is deliberately absent: the order-placed
// receipt (send-order-email) already covers it, so a second email would be noise.
const STATUS_COPY: Record<string, { subject: string; heading: string; message: string }> = {
  confirmed: {
    subject: 'Your 224 Clubhouse order is confirmed 🌿',
    heading: 'Order Confirmed 🌿',
    message: 'Good news, {name} — your order has been confirmed and will be prepared shortly.',
  },
  preparing: {
    subject: 'Your 224 Clubhouse order is being prepared',
    heading: 'Preparing Your Order',
    message: '{name}, your order is being prepared with care. We’ll let you know the moment it’s on its way.',
  },
  out_for_delivery: {
    subject: 'Your 224 Clubhouse order is out for delivery 🚚',
    heading: 'Out for Delivery 🚚',
    message: '{name}, your order is on its way to you — follow your driver live on the tracking page. If you’re paying on delivery, have your payment ready.',
  },
  delivered: {
    subject: 'Your 224 Clubhouse order has been delivered',
    heading: 'Order Delivered ✅',
    message: 'Enjoy, {name}! Your order has been delivered. Thank you for choosing 224 Clubhouse.',
  },
  cancelled: {
    subject: 'Your 224 Clubhouse order has been cancelled',
    heading: 'Order Cancelled',
    message: '{name}, your order has been cancelled. If this wasn’t expected, please get in touch with us.',
  },
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const payload: StatusEmailPayload = await req.json()
    const { orderId } = payload
    const nearby = payload.kind === 'nearby'
    if (!orderId) return jsonResponse({ error: 'orderId is required' }, 400)

    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader) return jsonResponse({ error: 'Not authenticated' }, 401)

    // --- Facts come from the DB, never from the payload ------------------
    const { data: order, error: orderError } = await serviceClient()
      .from('orders')
      .select('order_number, customer_name, customer_email, status, driver_id')
      .eq('id', orderId)
      .single()

    if (orderError || !order) return jsonResponse({ error: 'Order not found' }, 404)

    // --- Authorization: an admin, or the driver assigned to this order ----
    // (drivers move their orders to out_for_delivery / delivered from the
    // driver portal). Both checks run under the caller's own JWT.
    let allowed = await callerIsAdmin(authHeader)
    if (!allowed && order.driver_id) {
      const caller = callerClient(authHeader)
      const jwt = authHeader.replace(/^Bearer\s+/i, '')
      const { data: userData } = await caller.auth.getUser(jwt)
      const { data: isDriver } = await caller.rpc('is_driver')
      allowed = userData?.user?.id === order.driver_id && isDriver === true
    }
    if (!allowed) return jsonResponse({ error: 'Not authorized' }, 403)

    const orderNumber: string = order.order_number
    const customerName: string = order.customer_name
    const customerEmail: string = order.customer_email
    const status: string = order.status

    // No email for 'pending' (covered by the order receipt) or for any status
    // without copy (legacy values like 'paid'/'shipped'). Report success so the
    // caller's fire-and-forget path never treats a deliberate skip as a failure.
    if (!nearby && (status === 'out_for_delivery' || status === 'delivered')) {
      const { data: drv } = order.driver_id
        ? await serviceClient().from('drivers').select('full_name').eq('user_id', order.driver_id).maybeSingle()
        : { data: null }
      const who = drv?.full_name ? tg(drv.full_name) : 'The driver'
      await notifyTelegram('deliveries',
        status === 'out_for_delivery'
          ? `🚚 ${who} set off with <b>${tg(orderNumber)}</b> for ${tg(customerName)}`
          : `✅ <b>${tg(orderNumber)}</b> delivered to ${tg(customerName)}${drv?.full_name ? ` by ${tg(drv.full_name)}` : ''}`,
        { text: 'Drivers', url: `${TG_SITE}/admin/drivers` })
    }

    const copy = nearby
      ? (status === 'out_for_delivery' ? NEARBY_COPY : undefined)
      : STATUS_COPY[status]
    if (!copy) {
      return jsonResponse({ success: true, skipped: true })
    }

    // Replacer function, not a replacement string: a name containing `$&` or
    // `$'` would otherwise be re-interpreted as a substitution pattern.
    const message = copy.message.replace('{name}', () => escapeHtml(customerName))

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0; padding:0; background-color:#0a0a0a; font-family:'Inter',Arial,sans-serif;">
  <div style="max-width:600px; margin:0 auto; padding:40px 20px;">

    <!-- Logo -->
    <div style="text-align:center; margin-bottom:40px;">
      ${emailLogo(200)}
    </div>

    <!-- Divider -->
    <div style="width:48px; height:1px; background:#C9A84C; margin:0 auto 40px;"></div>

    <!-- Heading -->
    <h1 style="color:#ffffff; font-family:Georgia,serif; font-size:28px; text-align:center; margin-bottom:8px; font-weight:600;">
      ${copy.heading}
    </h1>
    <p style="color:#888888; text-align:center; margin-bottom:40px; font-size:15px;">
      ${message}
    </p>

    <!-- Order Card -->
    <div style="background:#111111; border:1px solid #222222; border-radius:12px; padding:28px; margin-bottom:24px; text-align:center;">
      <div style="color:#888888; font-size:11px; text-transform:uppercase; letter-spacing:2px; margin-bottom:6px;">Your Order Number</div>
      <div style="color:#C9A84C; font-family:monospace; font-size:22px; font-weight:700; letter-spacing:1px;">${escapeHtml(orderNumber)}</div>
    </div>

    <!-- Track -->
    <div style="text-align:center; margin-bottom:32px;">
      <a href="${SITE_URL}/track?order=${encodeURIComponent(orderNumber)}"
         style="display:inline-block; background:#C9A84C; color:#0a0a0a; text-decoration:none; padding:14px 32px; border-radius:8px; font-size:13px; font-weight:700; text-transform:uppercase; letter-spacing:2px;">
        Track your order
      </a>
    </div>

    <!-- Footer -->
    <div style="text-align:center; border-top:1px solid #222222; padding-top:28px;">
      ${emailLogo(110, 'margin-bottom:16px;')}
      <p style="color:#888888; font-size:12px; margin-bottom:4px;">224 Rondebult Road, Libradene, Boksburg, 1459</p>
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
        from: `224 Clubhouse <orders@${MAIL_FROM_DOMAIN}>`,
        to: customerEmail,
        subject: copy.subject,
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
