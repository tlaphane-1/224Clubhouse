import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { escapeHtml } from '../_shared/escapeHtml.ts'
import { callerClient, callerIsAdmin, callerTenant, serviceClient } from '../_shared/supabaseClients.ts'
import { DEFAULT_STORE } from '../_shared/stores.ts'
import { darkFooter, emailLogo } from '../_shared/brand.ts'
import { notifyTelegram, tg } from '../_shared/telegram.ts'
import { alertStore } from '../_shared/storeAlerts.ts'
import { sendStoreMail } from '../_shared/mail.ts'

// Branded and sent as the store the order belongs to (orders.tenant).

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
// {store} in a subject or message is the store's name.
const NEARBY_COPY = {
  subject: 'Your {store} driver is nearby 🚚',
  heading: 'Your Driver Is Nearby 🚚',
  message: '{name}, your driver is less than a kilometre away — please be ready to receive your order.',
}

// Per-status subject + copy. 'pending' is deliberately absent: the order-placed
// receipt (send-order-email) already covers it, so a second email would be noise.
const STATUS_COPY: Record<string, { subject: string; heading: string; message: string }> = {
  confirmed: {
    subject: 'Your {store} order is confirmed 🌿',
    heading: 'Order Confirmed 🌿',
    message: 'Good news, {name} — your order has been confirmed and will be prepared shortly.',
  },
  preparing: {
    subject: 'Your {store} order is being prepared',
    heading: 'Preparing Your Order',
    message: '{name}, your order is being prepared with care. We’ll let you know the moment it’s on its way.',
  },
  out_for_delivery: {
    subject: 'Your {store} order is out for delivery 🚚',
    heading: 'Out for Delivery 🚚',
    message: '{name}, your order is on its way to you — follow your driver live on the tracking page. If you’re paying on delivery, have your payment ready.',
  },
  delivered: {
    subject: 'Your {store} order has been delivered',
    heading: 'Order Delivered ✅',
    message: 'Enjoy, {name}! Your order has been delivered. Thank you for choosing {store}.',
  },
  cancelled: {
    subject: 'Your {store} order has been cancelled',
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
      .select('order_number, customer_name, customer_email, status, driver_id, tenant')
      .eq('id', orderId)
      .single()

    if (orderError || !order) return jsonResponse({ error: 'Order not found' }, 404)

    // --- Authorization: an admin, or the driver assigned to this order ----
    // (drivers move their orders to out_for_delivery / delivered from the
    // driver portal). Both checks run under the caller's own JWT.
    // is_admin() only proves the caller administers THEIR store.
    let allowed = (await callerIsAdmin(authHeader))
      && (await callerTenant(authHeader)) === (order.tenant || DEFAULT_STORE)
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
      const store = await alertStore(order.tenant)
      await notifyTelegram('deliveries',
        status === 'out_for_delivery'
          ? `🚚 ${who} set off with <b>${tg(orderNumber)}</b> for ${tg(customerName)}`
          : `✅ <b>${tg(orderNumber)}</b> delivered to ${tg(customerName)}${drv?.full_name ? ` by ${tg(drv.full_name)}` : ''}`,
        { text: 'Drivers', url: `${store.siteUrl}/admin/drivers` }, store.tenant)
    }

    const copy = nearby
      ? (status === 'out_for_delivery' ? NEARBY_COPY : undefined)
      : STATUS_COPY[status]
    if (!copy) {
      return jsonResponse({ success: true, skipped: true })
    }

    const brand = (await alertStore(order.tenant)).brand
    if (!brand) return jsonResponse({ error: `No email settings for store ${order.tenant}` }, 500)

    // Replacer functions, not replacement strings: a name containing `$&` or
    // `$'` would otherwise be re-interpreted as a substitution pattern.
    const message = copy.message
      .replace('{name}', () => escapeHtml(customerName))
      .replace('{store}', () => escapeHtml(brand.name))
    const subject = copy.subject.replace('{store}', () => brand.name)

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
      ${copy.heading}
    </h1>
    <p style="color:#888888; text-align:center; margin-bottom:40px; font-size:15px;">
      ${message}
    </p>

    <!-- Order Card -->
    <div style="background:#111111; border:1px solid #222222; border-radius:12px; padding:28px; margin-bottom:24px; text-align:center;">
      <div style="color:#888888; font-size:11px; text-transform:uppercase; letter-spacing:2px; margin-bottom:6px;">Your Order Number</div>
      <div style="color:${brand.gold}; font-family:monospace; font-size:22px; font-weight:700; letter-spacing:1px;">${escapeHtml(orderNumber)}</div>
    </div>

    <!-- Track -->
    <div style="text-align:center; margin-bottom:32px;">
      <a href="${brand.siteUrl}/track?order=${encodeURIComponent(orderNumber)}"
         style="display:inline-block; background:${brand.gold}; color:#0a0a0a; text-decoration:none; padding:14px 32px; border-radius:8px; font-size:13px; font-weight:700; text-transform:uppercase; letter-spacing:2px;">
        Track your order
      </a>
    </div>

    <!-- Footer -->${darkFooter(brand)}

  </div>
</body>
</html>`

    const sent = await sendStoreMail(brand, { sender: 'orders', to: customerEmail, subject, html })
    if (!sent.sent) throw new Error(sent.reason)

    return jsonResponse({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return jsonResponse({ error: message }, 500)
  }
})
