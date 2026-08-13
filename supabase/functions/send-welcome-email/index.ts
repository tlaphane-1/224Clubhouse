import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
// Interim: sends go out from a domain already verified on the Resend account until
// 224clubhouse.co.za is verified there. Unset MAIL_FROM_DOMAIN to revert to the default.
const MAIL_FROM_DOMAIN = Deno.env.get('MAIL_FROM_DOMAIN') ?? '224clubhouse.co.za'

interface WelcomeEmailPayload {
  firstName: string
  email: string
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } })
  }

  try {
    const payload: WelcomeEmailPayload = await req.json()
    const { firstName, email } = payload

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
      Welcome to the 224 Family 🔥
    </h1>
    <p style="color:#888888; text-align:center; margin-bottom:40px; font-size:15px; line-height:1.6;">
      Hey ${firstName}! You're in. Thanks for joining the 224 Clubhouse community —<br/>
      you'll be the first to know about new drops, events, and exclusive offers.
    </p>

    <!-- Promo Code -->
    <div style="background:#111111; border:1px solid #C9A84C; border-radius:12px; padding:32px; margin-bottom:32px; text-align:center;">
      <div style="color:#888888; font-size:11px; text-transform:uppercase; letter-spacing:3px; margin-bottom:12px;">Your Welcome Gift</div>
      <div style="color:#C9A84C; font-size:36px; font-family:'Courier New',monospace; font-weight:900; letter-spacing:6px; margin-bottom:12px;">
        WELCOME10
      </div>
      <div style="color:#ffffff; font-size:14px; margin-bottom:8px; font-weight:600;">10% OFF your first order</div>
      <div style="color:#888888; font-size:12px;">Use this code at checkout — valid for your first purchase only</div>
    </div>

    <!-- CTA -->
    <div style="text-align:center; margin-bottom:40px;">
      <a href="https://224clubhouse.co.za/shop"
         style="display:inline-block; background:#C9A84C; color:#000000; text-decoration:none;
                padding:14px 36px; border-radius:8px; font-weight:700; font-size:13px;
                text-transform:uppercase; letter-spacing:3px;">
        Shop Now
      </a>
    </div>

    <!-- What to Expect -->
    <div style="background:#111111; border:1px solid #222222; border-radius:12px; padding:24px; margin-bottom:32px;">
      <div style="color:#C9A84C; font-size:11px; text-transform:uppercase; letter-spacing:2px; margin-bottom:16px;">What to Expect</div>
      <div style="color:#888888; font-size:13px; line-height:1.8;">
        🌿 Early access to new stock drops<br/>
        🎉 Exclusive member events & invites<br/>
        📦 Updates on your orders<br/>
        🔥 Members-only deals & offers
      </div>
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
      <p style="color:#444; font-size:11px;">If you didn't sign up, you can safely ignore this email.</p>
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
        from: `224 Clubhouse <hello@${MAIL_FROM_DOMAIN}>`,
        to: email,
        subject: 'Welcome to the 224 family 🔥',
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
