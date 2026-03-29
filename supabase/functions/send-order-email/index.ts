import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''

interface OrderItem {
  name: string
  price: number
  quantity: number
}

interface OrderEmailPayload {
  orderId: string
  customerName: string
  customerEmail: string
  items: OrderItem[]
  total: number
  paystack_reference: string
}

function formatZAR(cents: number): string {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(cents / 100)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } })
  }

  try {
    const payload: OrderEmailPayload = await req.json()
    const { orderId, customerName, customerEmail, items, total, paystack_reference } = payload

    const itemRows = items.map(item => `
      <tr>
        <td style="padding: 8px 0; color: #ffffff; border-bottom: 1px solid #222222;">${item.name}</td>
        <td style="padding: 8px 0; color: #888888; text-align: center; border-bottom: 1px solid #222222;">${item.quantity}</td>
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
      Thank you, ${customerName}! Your order has been received and is being processed.
    </p>

    <!-- Order Card -->
    <div style="background:#111111; border:1px solid #222222; border-radius:12px; padding:28px; margin-bottom:24px;">

      <!-- Reference -->
      <div style="display:flex; justify-content:space-between; margin-bottom:24px; padding-bottom:16px; border-bottom:1px solid #222222;">
        <div>
          <div style="color:#888888; font-size:11px; text-transform:uppercase; letter-spacing:2px; margin-bottom:4px;">Order Reference</div>
          <div style="color:#C9A84C; font-family:monospace; font-size:13px;">${paystack_reference}</div>
        </div>
        <div style="text-align:right;">
          <div style="color:#888888; font-size:11px; text-transform:uppercase; letter-spacing:2px; margin-bottom:4px;">Status</div>
          <div style="color:#4ade80; font-size:13px; font-weight:600; text-transform:uppercase;">Paid</div>
        </div>
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

      <!-- Total -->
      <div style="margin-top:20px; padding-top:16px; border-top:1px solid #333333; display:flex; justify-content:space-between;">
        <span style="color:#ffffff; font-weight:600; font-size:15px;">Total Paid</span>
        <span style="color:#C9A84C; font-weight:700; font-size:18px;">${formatZAR(total)}</span>
      </div>
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
        from: 'orders@224clubhouse.co.za',
        to: customerEmail,
        subject: 'Your 224 Clubhouse order is confirmed 🌿',
        html,
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(err)
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
