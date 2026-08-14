import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { escapeHtml } from '../_shared/escapeHtml.ts'
import { callerClient, serviceClient } from '../_shared/supabaseClients.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
// Interim: sends go out from a domain already verified on the Resend account until
// 224clubhouse.co.za is verified there. Unset MAIL_FROM_DOMAIN to revert to the default.
const MAIL_FROM_DOMAIN = Deno.env.get('MAIL_FROM_DOMAIN') ?? '224clubhouse.co.za'
// Internal owner alert. Unset = no alert at all (the customer receipt is unaffected).
// Comma-separated for several recipients: "owner@x.co.za, manager@x.co.za".
const ADMIN_ALERT_EMAIL = Deno.env.get('ADMIN_ALERT_EMAIL') ?? ''

interface OrderItem {
  name: string
  price: number
  quantity: number
}

// Shape written by place_cod_order's jsonb_build_object — see
// supabase/migrations/*_customer_accounts_orders.sql.
interface ShippingAddress {
  street?: string
  apartment?: string
  city?: string
  province?: string
  postalCode?: string
}

// The ONLY thing the client may supply. Recipient, name, items and totals are
// read from the database: anything caller-supplied would let anyone with the
// (public) anon key send branded mail from the club's verified domain to any
// address they like.
interface OrderEmailPayload {
  orderId: string
}

const SITE_URL = 'https://224clubhouse.web.app'

// The values the orders_payment_method_check constraint actually allows are
// 'cash_on_delivery' / 'card_on_delivery' / 'online'; the short forms are kept
// for any legacy row.
function paymentLabel(method?: string): string {
  if (method === 'card' || method === 'card_on_delivery') return 'Card on delivery'
  if (method === 'cash' || method === 'cash_on_delivery') return 'Cash on delivery'
  return 'On delivery'
}

function formatZAR(cents: number): string {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(cents / 100)
}

function formatPlacedAt(value?: string | null): string {
  if (!value) return 'Unknown'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  // Stored as timestamptz and edge functions run in UTC — pin the club's zone
  // or the owner reads a delivery time two hours behind reality.
  return new Intl.DateTimeFormat('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function formatAddress(address: ShippingAddress | null): string {
  if (!address) return 'No address on the order'
  const line = [address.street, address.apartment, address.city, address.province, address.postalCode]
    .map(part => String(part ?? '').trim())
    .filter(Boolean)
    .join(', ')
  return line || 'No address on the order'
}

// --- Internal owner alert -------------------------------------------------
// Deliberately NOT the customer template: cash on delivery means nobody knows
// an order exists until someone opens the dashboard, so this is an operational
// note read on a phone — facts at the top, plain and scannable.

interface OwnerAlert {
  orderNumber: string
  placedAt: string
  customerName: string
  customerEmail: string
  customerPhone: string
  address: string
  items: OrderItem[]
  subtotal: number
  discountCode: string | null
  discountCents: number
  shippingFee: number
  total: number
  paymentMethod?: string
}

function ownerAlertHtml(alert: OwnerAlert): string {
  const rows = alert.items.map(item => `
        <tr>
          <td style="padding:6px 0; border-bottom:1px solid #eeeeee;">${escapeHtml(item.name)}</td>
          <td style="padding:6px 0; border-bottom:1px solid #eeeeee; text-align:center; white-space:nowrap;">&times;&nbsp;${escapeHtml(item.quantity)}</td>
          <td style="padding:6px 0; border-bottom:1px solid #eeeeee; text-align:right; white-space:nowrap;">${escapeHtml(formatZAR(item.price * item.quantity))}</td>
        </tr>`).join('')

  // Without this row the driver reads "Subtotal R500 + Delivery R0 = collect
  // R450" and the maths does not reconcile at the door.
  const discountRow = alert.discountCents > 0 ? `
          <tr>
            <td colspan="2" style="padding:2px 0; color:#666666;">${escapeHtml(
              alert.discountCode ? `Discount (${alert.discountCode})` : 'Discount'
            )}</td>
            <td style="padding:2px 0; text-align:right;">&minus;${escapeHtml(formatZAR(alert.discountCents))}</td>
          </tr>` : ''

  const detail = (label: string, value: string) => `
        <tr>
          <td style="padding:4px 12px 4px 0; color:#666666; vertical-align:top; white-space:nowrap;">${escapeHtml(label)}</td>
          <td style="padding:4px 0; color:#111111;">${escapeHtml(value)}</td>
        </tr>`

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0; padding:0; background:#f4f4f4; font-family:Arial,Helvetica,sans-serif; color:#111111;">
  <div style="max-width:560px; margin:0 auto; padding:20px 12px;">
    <div style="background:#ffffff; border:1px solid #e2e2e2; border-radius:8px; padding:20px;">

      <!-- The three facts that decide what happens next -->
      <div style="font-size:12px; letter-spacing:2px; text-transform:uppercase; color:#777777;">New order</div>
      <div style="font-family:monospace; font-size:24px; font-weight:700; margin:4px 0 2px;">${escapeHtml(alert.orderNumber)}</div>
      <div style="font-size:22px; font-weight:700;">${escapeHtml(formatZAR(alert.total))}</div>
      <div style="font-size:14px; color:#555555; margin-top:2px;">
        ${escapeHtml(paymentLabel(alert.paymentMethod))} &middot; ${escapeHtml(alert.placedAt)}
      </div>

      <div style="height:2px; background:#C9A84C; margin:16px 0;"></div>

      <table style="width:100%; border-collapse:collapse; font-size:14px;">
        ${detail('Customer', alert.customerName)}
        ${detail('Phone', alert.customerPhone)}
        ${detail('Email', alert.customerEmail)}
        ${detail('Deliver to', alert.address)}
      </table>

      <table style="width:100%; border-collapse:collapse; font-size:14px; margin-top:16px;">
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <td colspan="2" style="padding:6px 0 0; color:#666666;">Subtotal</td>
            <td style="padding:6px 0 0; text-align:right;">${escapeHtml(formatZAR(alert.subtotal))}</td>
          </tr>${discountRow}
          <tr>
            <td colspan="2" style="padding:2px 0; color:#666666;">Delivery</td>
            <td style="padding:2px 0; text-align:right;">${escapeHtml(formatZAR(alert.shippingFee))}</td>
          </tr>
          <tr>
            <td colspan="2" style="padding:6px 0 0; font-weight:700; border-top:1px solid #dddddd;">To collect on delivery</td>
            <td style="padding:6px 0 0; font-weight:700; text-align:right; border-top:1px solid #dddddd;">${escapeHtml(formatZAR(alert.total))}</td>
          </tr>
        </tfoot>
      </table>

      <div style="margin-top:20px;">
        <a href="${SITE_URL}/admin/orders"
           style="display:inline-block; background:#111111; color:#ffffff; text-decoration:none; padding:12px 22px; border-radius:6px; font-size:14px; font-weight:700;">
          Open admin orders
        </a>
      </div>

      <div style="margin-top:20px; padding-top:14px; border-top:1px solid #eeeeee; font-size:11px; color:#999999;">
        <span style="color:#C9A84C; font-weight:700; letter-spacing:2px;">224</span> Clubhouse &middot; internal order alert
      </div>
    </div>
  </div>
</body>
</html>`
}

/**
 * Throws on a failed send. Callers MUST swallow that: the customer's receipt is
 * the contract with the browser, the owner alert is a courtesy on top of it.
 */
async function sendOwnerAlert(alert: OwnerAlert): Promise<void> {
  const to = ADMIN_ALERT_EMAIL.split(',').map(address => address.trim()).filter(Boolean)
  if (to.length === 0) return // secret not set yet — a deliberate, silent no-op

  const subject = `New order ${alert.orderNumber} — ${formatZAR(alert.total)} (${paymentLabel(alert.paymentMethod).toLowerCase()})`

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `224 Clubhouse <orders@${MAIL_FROM_DOMAIN}>`,
      to,
      subject,
      html: ownerAlertHtml(alert),
    }),
  })

  if (!res.ok) throw new Error(await res.text())
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
      .select(
        'order_number, customer_name, customer_email, customer_phone, items, subtotal, ' +
        'discount_code, discount_cents, shipping_fee, total, payment_method, ' +
        'shipping_address, created_at, user_id'
      )
      .eq('id', orderId)
      .single()

    if (orderError || !order) return jsonResponse({ error: 'Order not found' }, 404)
    if (order.user_id !== caller.id) return jsonResponse({ error: 'Not authorized' }, 403)

    const orderNumber: string = order.order_number
    const customerName: string = order.customer_name
    const customerEmail: string = order.customer_email
    const items: OrderItem[] = Array.isArray(order.items) ? order.items : []
    const total: number = order.total
    const subtotal: number = order.subtotal ?? 0
    const shippingFee: number = order.shipping_fee ?? 0
    const discountCents: number = order.discount_cents ?? 0
    const discountCode: string | null = order.discount_code ?? null
    const paymentMethod: string | undefined = order.payment_method ?? undefined

    const itemRows = items.map(item => `
      <tr>
        <td style="padding: 8px 0; color: #ffffff; border-bottom: 1px solid #222222;">${escapeHtml(item.name)}</td>
        <td style="padding: 8px 0; color: #888888; text-align: center; border-bottom: 1px solid #222222;">${escapeHtml(item.quantity)}</td>
        <td style="padding: 8px 0; color: #C9A84C; text-align: right; border-bottom: 1px solid #222222;">${formatZAR(item.price * item.quantity)}</td>
      </tr>
    `).join('')

    // Only shown when a code was applied: otherwise the item lines already add
    // up to the amount due and an extra breakdown is noise. With a discount the
    // customer needs to see how R500 of items becomes R450 at the door, or the
    // driver is the one who has to explain it.
    const breakdownRows = discountCents > 0 ? `
          <tr>
            <td style="color:#888888; font-size:13px; padding-bottom:4px;">Subtotal</td>
            <td style="color:#888888; font-size:13px; text-align:right; padding-bottom:4px;">${escapeHtml(formatZAR(subtotal))}</td>
          </tr>
          <tr>
            <td style="color:#888888; font-size:13px; padding-bottom:4px;">${escapeHtml(
              discountCode ? `Discount (${discountCode})` : 'Discount'
            )}</td>
            <td style="color:#888888; font-size:13px; text-align:right; padding-bottom:4px;">&minus;${escapeHtml(formatZAR(discountCents))}</td>
          </tr>${shippingFee > 0 ? `
          <tr>
            <td style="color:#888888; font-size:13px; padding-bottom:8px;">Delivery</td>
            <td style="color:#888888; font-size:13px; text-align:right; padding-bottom:8px;">${escapeHtml(formatZAR(shippingFee))}</td>
          </tr>` : ''}` : ''

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
        <table style="width:100%;">${breakdownRows}
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

    // The customer receipt is what this endpoint promises the browser. Its
    // failure is captured rather than thrown so the owner still gets told an
    // order exists — the response shape below is unchanged either way.
    let customerSendError: unknown = null
    try {
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
    } catch (error) {
      customerSendError = error
    }

    // Owner alert: strictly additive. Anything it throws (bad recipient,
    // Resend outage, malformed row) is logged and dropped here so it can never
    // turn a delivered receipt into a 500 for the customer's browser.
    try {
      await sendOwnerAlert({
        orderNumber,
        placedAt: formatPlacedAt(order.created_at),
        customerName,
        customerEmail,
        customerPhone: order.customer_phone ?? 'Not provided',
        address: formatAddress((order.shipping_address ?? null) as ShippingAddress | null),
        items,
        subtotal,
        discountCode,
        discountCents,
        shippingFee,
        total,
        paymentMethod,
      })
    } catch (alertError) {
      console.error('[send-order-email] owner alert failed:', alertError)
    }

    if (customerSendError) throw customerSendError

    return jsonResponse({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return jsonResponse({ error: message }, 500)
  }
})
