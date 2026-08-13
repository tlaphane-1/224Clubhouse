import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { escapeHtml } from '../_shared/escapeHtml.ts'
import { callerClient, serviceClient } from '../_shared/supabaseClients.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
// Interim: sends go out from a domain already verified on the Resend account until
// 224clubhouse.co.za is verified there. Unset MAIL_FROM_DOMAIN to revert to the default.
const MAIL_FROM_DOMAIN = Deno.env.get('MAIL_FROM_DOMAIN') ?? '224clubhouse.co.za'

interface OrderItem {
  name: string
  price: number
  quantity: number
}

// The ONLY thing the client may supply. Recipient, name, items and totals are
// read from the database: anything caller-supplied would let anyone with the
// (public) anon key send branded mail from the club's verified domain to any
// address they like.
interface OrderEmailPayload {
  orderId: string
}

const SITE_URL = 'https://224clubhouse.web.app'

function paymentLabel(method?: string): string {
  if (method === 'card') return 'Card on delivery'
  if (method === 'cash') return 'Cash on delivery'
  return 'On delivery'
}

function formatZAR(cents: number): string {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(cents / 100)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const payload: OrderEmailPayload = await req.json()
    const { orderId } = payload
    if (!orderId) return jsonResponse({ error: 'orderId is required' }, 400)

    // --- Authorization: the caller must OWN this order -------------------
    // Customer-triggered at checkout, so this is not an admin gate: the JWT
    // must resolve to the user whose id is stamped on the order.
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader) return jsonResponse({ error: 'Not authenticated' }, 401)

    // getUser() must be given the JWT explicitly: there is no persisted session
    // in an edge function, so the no-argument form would always come back empty.
    // A logged-out caller sends the anon key here, which resolves to no user.
    const jwt = authHeader.replace(/^Bearer\s+/i, '')
    const { data: userData, error: userError } = await callerClient(authHeader).auth.getUser(jwt)
    const caller = userData?.user
    if (userError || !caller) return jsonResponse({ error: 'Not authenticated' }, 401)

    // --- Facts come from the DB, never from the payload ------------------
    const admin = serviceClient()
    const { data: order, error: orderError } = await admin
      .from('orders')
      .select('order_number, customer_name, customer_email, items, total, payment_method, user_id')
      .eq('id', orderId)
      .single()

    if (orderError || !order) return jsonResponse({ error: 'Order not found' }, 404)
    if (order.user_id !== caller.id) return jsonResponse({ error: 'Not authorized' }, 403)

    const orderNumber: string = order.order_number
    const customerName: string = order.customer_name
    const customerEmail: string = order.customer_email
    const items: OrderItem[] = Array.isArray(order.items) ? order.items : []
    const total: number = order.total
    const paymentMethod: string | undefined = order.payment_method ?? undefined

    const itemRows = items.map(item => `
      <tr>
        <td style="padding: 8px 0; color: #ffffff; border-bottom: 1px solid #222222;">${escapeHtml(item.name)}</td>
        <td style="padding: 8px 0; color: #888888; text-align: center; border-bottom: 1px solid #222222;">${escapeHtml(item.quantity)}</td>
        <td style="padding: 8px 0; color: #C9A84C; text-align: right; border-bottom: 1px solid #222222;">${formatZAR(item.price * item.quantity)}</td>
      </tr>
    `).join('')

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
      Order Confirmed 🌿
    </h1>
    <p style="color:#888888; text-align:center; margin-bottom:40px; font-size:15px;">
      Thank you, ${escapeHtml(customerName)}! Your order has been received and is being processed.
    </p>

    <!-- Order Card -->
    <div style="background:#111111; border:1px solid #222222; border-radius:12px; padding:28px; margin-bottom:24px;">

      <!-- Order number: the whole point of this email. Customers who lose it cannot
           track their order, which is what prompted adding this. -->
      <div style="margin-bottom:24px; padding-bottom:16px; border-bottom:1px solid #222222; text-align:center;">
        <div style="color:#888888; font-size:11px; text-transform:uppercase; letter-spacing:2px; margin-bottom:6px;">Your Order Number</div>
        <div style="color:#C9A84C; font-family:monospace; font-size:22px; font-weight:700; letter-spacing:1px;">${escapeHtml(orderNumber)}</div>
        <div style="color:#888888; font-size:12px; margin-top:8px;">Keep this to track your order.</div>
      </div>

      <!-- Items -->
      <table style="width:100%; border-collapse:collapse;">
        <thead>
          <tr>
            <th style="color:#888888; font-size:11px; text-transform:uppercase; letter-spacing:2px; padding-bottom:8px; text-align:left; font-weight:500;">Item</th>
            <th style="color:#888888; font-size:11px; text-transform:uppercase; letter-spacing:2px; padding-bottom:8px; text-align:center; font-weight:500;">Qty</th>
            <th style="color:#888888; font-size:11px; text-transform:uppercase; letter-spacing:2px; padding-bottom:8px; text-align:right; font-weight:500;">Price</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>

      <!-- Amount due. NOT "Total Paid" — this is cash/card on delivery, nothing has
           been charged yet, and saying otherwise invites a dispute at the door. -->
      <div style="margin-top:20px; padding-top:16px; border-top:1px solid #333333;">
        <table style="width:100%;">
          <tr>
            <td style="color:#ffffff; font-weight:600; font-size:15px;">Amount due on delivery</td>
            <td style="color:#C9A84C; font-weight:700; font-size:18px; text-align:right;">${formatZAR(total)}</td>
          </tr>
        </table>
        <div style="color:#888888; font-size:12px; margin-top:6px;">${paymentLabel(paymentMethod)} — no payment is needed now.</div>
      </div>
    </div>

    <!-- Track -->
    <div style="text-align:center; margin-bottom:32px;">
      <a href="${SITE_URL}/track?order=${encodeURIComponent(orderNumber)}"
         style="display:inline-block; background:#C9A84C; color:#0a0a0a; text-decoration:none; padding:14px 32px; border-radius:8px; font-size:13px; font-weight:700; text-transform:uppercase; letter-spacing:2px;">
        Track your order
      </a>
    </div>

    <!-- Delivery -->
    <div style="background:#111111; border:1px solid #222222; border-radius:12px; padding:20px; margin-bottom:32px; text-align:center;">
      <div style="color:#C9A84C; font-size:11px; text-transform:uppercase; letter-spacing:2px; margin-bottom:6px;">Estimated Delivery</div>
      <div style="color:#ffffff; font-size:15px; font-weight:600;">2–5 Business Days</div>
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
        from: `224 Clubhouse <orders@${MAIL_FROM_DOMAIN}>`,
        to: customerEmail,
        subject: 'Your 224 Clubhouse order is confirmed 🌿',
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
