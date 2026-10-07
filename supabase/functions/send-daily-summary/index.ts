import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { jsonResponse } from '../_shared/cors.ts'
import { escapeHtml } from '../_shared/escapeHtml.ts'
import { serviceClient } from '../_shared/supabaseClients.ts'
import { notifyTelegram, tg, SITE_URL as TG_SITE } from '../_shared/telegram.ts'

// Daily 07:00 summary to the club (migration 20261008130000_owner_alerts).
// Called by pg_cron only — deployed with --no-verify-jwt; the shared
// x-cron-secret header (vault `cart_reminders_cron_secret` == env CRON_SECRET)
// is the authentication. Always sends: it doubles as a daily heartbeat.

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const MAIL_FROM_DOMAIN = Deno.env.get('MAIL_FROM_DOMAIN') ?? '224clubhouse.co.za'
const ADMIN_ALERT_EMAIL = Deno.env.get('ADMIN_ALERT_EMAIL') ?? ''
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? ''
const SITE_URL = 'https://224clubhouse.store'

interface Summary {
  day: string
  visitors: number
  page_views: number
  new_accounts: number
  orders: number
  booked_cents: number
  delivered: number
  delivered_cents: number
  eft_awaiting: number
  eft_proof: number
  reviews_pending: number
  memberships_pending: number
  low_stock: { name: string; left: number }[]
}

function formatZAR(cents: number): string {
  return `R${(cents / 100).toFixed(2)}`
}

/** Constant-time compare (same as send-cart-reminders). */
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const x = enc.encode(a)
  const y = enc.encode(b)
  if (x.length !== y.length) return false
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]
  return diff === 0
}

/** Yesterday's date in Johannesburg (UTC+2, no DST), as YYYY-MM-DD. */
function yesterdaySast(): string {
  const sastNow = new Date(Date.now() + 2 * 3600 * 1000)
  sastNow.setUTCDate(sastNow.getUTCDate() - 1)
  return sastNow.toISOString().slice(0, 10)
}

function summaryHtml(s: Summary): string {
  const dayLabel = new Date(`${s.day}T12:00:00Z`).toLocaleDateString('en-ZA', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Johannesburg',
  })
  const stat = (label: string, value: string) => `
        <td style="padding:10px; width:33%; vertical-align:top;">
          <div style="font-size:11px; letter-spacing:1px; text-transform:uppercase; color:#777777;">${escapeHtml(label)}</div>
          <div style="font-size:20px; font-weight:700; color:#111111; margin-top:2px;">${escapeHtml(value)}</div>
        </td>`
  const todo = [
    s.eft_proof > 0 && `${s.eft_proof} EFT proof${s.eft_proof === 1 ? '' : 's'} of payment to check`,
    s.eft_awaiting > 0 && `${s.eft_awaiting} EFT order${s.eft_awaiting === 1 ? '' : 's'} awaiting payment`,
    s.reviews_pending > 0 && `${s.reviews_pending} review${s.reviews_pending === 1 ? '' : 's'} to approve`,
    s.memberships_pending > 0 && `${s.memberships_pending} membership application${s.memberships_pending === 1 ? '' : 's'} pending`,
  ].filter(Boolean) as string[]

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0; padding:0; background:#f4f4f4; font-family:Arial,Helvetica,sans-serif; color:#111111;">
  <div style="max-width:560px; margin:0 auto; padding:20px 12px;">
    <div style="background:#ffffff; border:1px solid #e2e2e2; border-radius:8px; padding:20px;">
      <div style="font-size:12px; letter-spacing:2px; text-transform:uppercase; color:#777777;">Daily summary</div>
      <div style="font-size:20px; font-weight:700; margin:4px 0 0;">${escapeHtml(dayLabel)}</div>
      <div style="height:2px; background:#C9A84C; margin:16px 0;"></div>

      <table style="width:100%; border-collapse:collapse;">
        <tr>${stat('Visitors', String(s.visitors))}${stat('Page views', String(s.page_views))}${stat('New accounts', String(s.new_accounts))}</tr>
        <tr>${stat('Orders', String(s.orders))}${stat('Booked', formatZAR(s.booked_cents))}${stat('Delivered', `${s.delivered} · ${formatZAR(s.delivered_cents)}`)}</tr>
      </table>

      <div style="margin-top:16px;">
        <div style="font-size:12px; letter-spacing:2px; text-transform:uppercase; color:#777777; margin-bottom:6px;">Waiting for you</div>
        ${todo.length
          ? todo.map(t => `<div style="font-size:14px; padding:3px 0;">• ${escapeHtml(t)}</div>`).join('')
          : '<div style="font-size:14px; color:#555555;">Nothing waiting. 🎉</div>'}
      </div>

      ${s.low_stock.length ? `
      <div style="margin-top:16px; padding:12px 14px; background:#fff8e6; border:1px solid #f0d58a; border-radius:6px;">
        <div style="font-size:12px; letter-spacing:2px; text-transform:uppercase; color:#8a6d1a; margin-bottom:6px;">Low stock</div>
        ${s.low_stock.map(l => `<div style="font-size:14px; padding:2px 0;">${escapeHtml(l.name)}: <strong>${l.left <= 0 ? 'SOLD OUT' : `${escapeHtml(l.left)} left`}</strong></div>`).join('')}
      </div>` : ''}

      <div style="margin-top:20px;">
        <a href="${SITE_URL}/admin/dashboard"
           style="display:inline-block; background:#111111; color:#ffffff; text-decoration:none; padding:12px 22px; border-radius:6px; font-size:14px; font-weight:700;">
          Open the dashboard
        </a>
      </div>
      <div style="margin-top:20px; padding-top:14px; border-top:1px solid #eeeeee; font-size:11px; color:#999999;">
        224 Clubhouse &middot; daily summary, sent every morning at 07:00
      </div>
    </div>
  </div>
</body>
</html>`
}

serve(async (req) => {
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
  const given = req.headers.get('x-cron-secret') ?? ''
  if (!CRON_SECRET || !safeEqual(given, CRON_SECRET)) return jsonResponse({ error: 'Unauthorized' }, 401)
  const day = yesterdaySast()
  const { data, error } = await serviceClient().rpc('daily_summary_data', { p_day: day })
  if (error || !data) return jsonResponse({ error: error?.message ?? 'No summary data' }, 500)
  const s = data as Summary

  const telegram = await notifyTelegram('daily',
    `☀️ <b>224 daily — ${tg(s.day)}</b>\n`
    + `👀 ${s.visitors} visitors · ${s.page_views} page views · ${s.new_accounts} new accounts\n`
    + `🛒 ${s.orders} orders · ${tg(formatZAR(s.booked_cents))} booked · ${s.delivered} delivered (${tg(formatZAR(s.delivered_cents))})\n`
    + `\n<b>Waiting for you</b>\n`
    + `🧾 EFT: ${s.eft_proof} proof${s.eft_proof === 1 ? '' : 's'} to check, ${s.eft_awaiting} awaiting payment\n`
    + `⭐ ${s.reviews_pending} review${s.reviews_pending === 1 ? '' : 's'} · 👑 ${s.memberships_pending} membership application${s.memberships_pending === 1 ? '' : 's'}`
    + (s.low_stock.length ? `\n\n⚠️ <b>Low stock</b>\n` + s.low_stock.map(l => `• ${tg(l.name)}: ${l.left === 0 ? 'SOLD OUT' : `${l.left} left`}`).join('\n') : ''),
    { text: 'Dashboard', url: `${TG_SITE}/admin/dashboard` })

  if (!RESEND_API_KEY) return jsonResponse({ error: 'RESEND_API_KEY not set', telegram }, 500)
  const to = ADMIN_ALERT_EMAIL.split(',').map(a => a.trim()).filter(Boolean)
  if (to.length === 0) return jsonResponse({ success: false, reason: 'ADMIN_ALERT_EMAIL not set', telegram })

  const subject = `224 daily: ${s.orders} order${s.orders === 1 ? '' : 's'}, ${s.visitors} visitor${s.visitors === 1 ? '' : 's'}`
    + (s.eft_proof + s.eft_awaiting > 0 ? ` · ${s.eft_proof + s.eft_awaiting} EFT to check` : '')

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `224 Clubhouse <orders@${MAIL_FROM_DOMAIN}>`, to, subject, html: summaryHtml(s) }),
  })
  if (!res.ok) return jsonResponse({ error: await res.text() }, 502)
  const sent = await res.json().catch(() => ({}))
  return jsonResponse({ success: true, day, id: sent?.id ?? null, telegram })
})
