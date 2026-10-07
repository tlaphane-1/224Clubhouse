import { serviceClient } from './supabaseClients.ts'

// Telegram group alerts (migration 20261008150000_telegram_alerts).
// Config (bot token from Vault, chat id, per-kind switches) is read through
// the service-role-only telegram_config() RPC. notifyTelegram never throws:
// a Telegram outage must not break the email or the caller's flow.

export type AlertKind =
  | 'orders'        // new order (+ low stock)
  | 'eft'           // proof of payment uploaded
  | 'reviews'       // review waiting
  | 'memberships'   // membership application
  | 'deliveries'    // driver started / delivered
  | 'daily'         // 07:00 summary

export const SITE_URL = 'https://224clubhouse.store'

/** Escape for Telegram's HTML parse mode. */
export function tg(text: unknown): string {
  return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

interface Button { text: string; url: string }

export async function sendTelegram(token: string, chatId: number | string, html: string, button?: Button) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: html,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...(button ? { reply_markup: { inline_keyboard: [[button]] } } : {}),
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body?.ok === false) throw new Error(body?.description ?? `Telegram HTTP ${res.status}`)
  return body
}

/** Post an alert to the configured group if Telegram is set up and this kind is on. */
export async function notifyTelegram(kind: AlertKind, html: string, button?: Button): Promise<string> {
  try {
    const { data, error } = await serviceClient().rpc('telegram_config')
    if (error) return `skipped: ${error.message}`
    if (!data?.token || !data?.chat_id || !data?.enabled) return 'skipped: not set up'
    if (data.kinds?.[kind] === false) return `skipped: ${kind} off`
    await sendTelegram(data.token, data.chat_id, html, button)
    return 'sent'
  } catch (e) {
    console.error('[telegram] alert failed:', e)
    return `failed: ${e instanceof Error ? e.message : String(e)}`
  }
}
