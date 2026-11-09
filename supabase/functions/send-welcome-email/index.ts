import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { escapeHtml } from '../_shared/escapeHtml.ts'
import { serviceClient } from '../_shared/supabaseClients.ts'
import { darkFooter, emailLogo } from '../_shared/brand.ts'
import { sendStoreMail } from '../_shared/mail.ts'
import { DEFAULT_STORE, storeFor } from '../_shared/stores.ts'

/**
 * `email` is the only field used. `firstName` is still accepted because the
 * caller (src/pages/Home.jsx) sends it, but it is IGNORED — the name and the
 * unsubscribe token are read from the subscriber row instead, so a caller
 * holding the public anon key cannot spoof the greeting or the opt-out link.
 * Home.jsx can drop firstName from its payload whenever it's next touched.
 *
 * `tenant` is the store the visitor subscribed in (the browser's store slug).
 * It only picks WHICH store's list to look in — the row must exist there —
 * and so which store's branding and sender the email uses. Missing means 224
 * (bundles from before stores existed); an unknown store is refused.
 */
interface WelcomeEmailPayload {
  email: string
  firstName?: string
  tenant?: string
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const payload: WelcomeEmailPayload = await req.json()
    // subscribe_newsletter stores lower(trim(email)) — normalise the same way
    // here or anyone who typed `Sam@Gmail.com` misses the lookup below, gets a
    // 404 the caller ignores, and is told to check an inbox nothing was sent to.
    const email = (payload?.email ?? '').trim().toLowerCase()
    if (!email) return jsonResponse({ error: 'email is required' }, 400)
    const brand = storeFor(payload?.tenant || DEFAULT_STORE)
    if (!brand) return jsonResponse({ error: 'Unknown store' }, 400)

    // --- Facts come from the DB, never from the payload -------------------
    // The row must already exist (Home.jsx inserts before invoking), which
    // also means this can only mail addresses that are actually on the list.
    const admin = serviceClient()
    const { data: subscriber, error: lookupError } = await admin
      .from('newsletter_subscribers')
      .select('email, first_name, unsubscribe_token, unsubscribed_at')
      .eq('email', email)
      .eq('tenant', brand.slug)
      .maybeSingle()

    if (lookupError || !subscriber) return jsonResponse({ error: 'Subscriber not found' }, 404)

    // Someone who has opted out never gets marketing mail again, even if a
    // stale client re-invokes this function for their address.
    if (subscriber.unsubscribed_at) {
      return jsonResponse({ success: false, reason: 'unsubscribed' })
    }

    const recipient: string = subscriber.email
    const greetingName: string = subscriber.first_name || 'there'
    const unsubscribeUrl =
      `${brand.siteUrl}/unsubscribe?token=${encodeURIComponent(subscriber.unsubscribe_token)}`

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
      Welcome to the ${escapeHtml(brand.shortName)} Family 🔥
    </h1>
    <p style="color:#888888; text-align:center; margin-bottom:40px; font-size:15px; line-height:1.6;">
      Hey ${escapeHtml(greetingName)}! You're in. Thanks for joining the ${escapeHtml(brand.name)} community —<br/>
      you'll be the first to know about new drops, events, and exclusive offers.
    </p>

    <!-- Promo Code: only where the store's site promises it -->${brand.welcomeOffer ? `
    <div style="background:#111111; border:1px solid ${brand.gold}; border-radius:12px; padding:32px; margin-bottom:32px; text-align:center;">
      <div style="color:#888888; font-size:11px; text-transform:uppercase; letter-spacing:3px; margin-bottom:12px;">Your Welcome Gift</div>
      <div style="color:${brand.gold}; font-size:36px; font-family:'Courier New',monospace; font-weight:900; letter-spacing:6px; margin-bottom:12px;">
        WELCOME10
      </div>
      <div style="color:#ffffff; font-size:14px; margin-bottom:8px; font-weight:600;">10% OFF your first order</div>
      <div style="color:#888888; font-size:12px;">Use this code at checkout — valid for your first purchase only</div>
    </div>` : ''}

    <!-- CTA -->
    <div style="text-align:center; margin-bottom:40px;">
      <a href="${brand.siteUrl}/store"
         style="display:inline-block; background:${brand.gold}; color:#000000; text-decoration:none;
                padding:14px 36px; border-radius:8px; font-weight:700; font-size:13px;
                text-transform:uppercase; letter-spacing:3px;">
        Shop Now
      </a>
    </div>

    <!-- What to Expect -->
    <div style="background:#111111; border:1px solid #222222; border-radius:12px; padding:24px; margin-bottom:32px;">
      <div style="color:${brand.gold}; font-size:11px; text-transform:uppercase; letter-spacing:2px; margin-bottom:16px;">What to Expect</div>
      <div style="color:#888888; font-size:13px; line-height:1.8;">
        🌿 Early access to new stock drops<br/>
        🎉 Exclusive member events & invites<br/>
        📦 Updates on your orders<br/>
        🔥 Members-only deals & offers
      </div>
    </div>

    <!-- Footer -->
    <div style="text-align:center; border-top:1px solid #222222; padding-top:28px;">
      ${emailLogo(brand, 110, 'margin-bottom:16px;')}
      <p style="color:#888888; font-size:12px; margin-bottom:4px;">${escapeHtml(brand.address)}</p>
      <p style="color:#888888; font-size:12px; margin-bottom:16px;">${escapeHtml(brand.hours)}</p>${brand.instagram || brand.facebook ? `
      <div style="display:flex; justify-content:center; gap:16px; margin-bottom:16px;">
        ${[
          brand.instagram ? `<a href="${escapeHtml(brand.instagram)}" style="color:${brand.gold}; text-decoration:none; font-size:12px;">Instagram</a>` : '',
          brand.facebook ? `<a href="${escapeHtml(brand.facebook)}" style="color:${brand.gold}; text-decoration:none; font-size:12px;">Facebook</a>` : '',
        ].filter(Boolean).join(`
        <span style="color:#333;">|</span>
        `)}
      </div>` : ''}
      <p style="color:#444; font-size:11px; margin-bottom:12px;">If you didn't sign up, you can safely ignore this email.</p>
      <p style="color:#888888; font-size:11px; line-height:1.6;">
        You're receiving this because you subscribed to the ${escapeHtml(brand.name)} newsletter.<br/>
        <a href="${escapeHtml(unsubscribeUrl)}" style="color:${brand.gold}; text-decoration:underline;">Unsubscribe</a>
        — one click, no login needed.
      </p>
    </div>

  </div>
</body>
</html>`

    const sent = await sendStoreMail(brand, {
      sender: 'hello',
      to: recipient,
      subject: `Welcome to the ${brand.shortName} family 🔥`,
      html,
      // Surfaces the opt-out in Gmail/Outlook's own UI. Deliberately WITHOUT
      // List-Unsubscribe-Post: the /unsubscribe route is a GET-only SPA page,
      // so advertising one-click POST would let a provider "unsubscribe"
      // someone without anything actually happening.
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
      },
    })
    if (!sent.sent) throw new Error(sent.reason)

    return jsonResponse({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return jsonResponse({ error: message }, 500)
  }
})
