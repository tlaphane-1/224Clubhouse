import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { callerIsAdmin, serviceClient } from '../_shared/supabaseClients.ts'
import { sendTelegram, tg } from '../_shared/telegram.ts'

// Admin → Alerts setup for Telegram group alerts. Admin only.
//   { action: 'save_token', token }      — check with getMe, store in Vault
//   { action: 'find_chats' }             — groups the bot has been added to / seen in
//   { action: 'select_chat', chatId }    — save the group and post a test message
//   { action: 'test' }                   — post a test message to the saved group
// The token never goes back to the browser.

async function tgApi(token: string, method: string, params: Record<string, unknown> = {}) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body?.ok === false) throw new Error(body?.description ?? `Telegram HTTP ${res.status}`)
  return body.result
}

async function config() {
  const { data, error } = await serviceClient().rpc('telegram_config')
  if (error) throw error
  return data ?? {}
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader) return jsonResponse({ error: 'Not authenticated' }, 401)
    if (!(await callerIsAdmin(authHeader))) return jsonResponse({ error: 'Not authorized' }, 403)

    const body = await req.json()
    const admin = serviceClient()

    if (body.action === 'save_token') {
      const token = String(body.token ?? '').trim()
      let me
      try {
        me = await tgApi(token, 'getMe')
      } catch {
        return jsonResponse({ error: "Telegram didn't accept that token. Copy it again from @BotFather." }, 400)
      }
      const { error } = await admin.rpc('store_telegram_token', { p_token: token })
      if (error) return jsonResponse({ error: error.message }, 400)
      return jsonResponse({ success: true, botUsername: me.username, botName: me.first_name })
    }

    const cfg = await config()
    if (!cfg.token) return jsonResponse({ error: 'Save the bot token first' }, 400)

    if (body.action === 'find_chats') {
      const me = await tgApi(cfg.token, 'getMe')
      const updates = await tgApi(cfg.token, 'getUpdates', {
        allowed_updates: ['message', 'my_chat_member', 'channel_post'],
      })
      const chats = new Map<number, { id: number; title: string; type: string }>()
      for (const u of updates ?? []) {
        const chat = u.my_chat_member?.chat ?? u.message?.chat ?? u.channel_post?.chat
        if (!chat || chat.type === 'private') continue
        // A bot that was removed again shouldn't be offered.
        const status = u.my_chat_member?.new_chat_member?.status
        if (status === 'left' || status === 'kicked') { chats.delete(chat.id); continue }
        chats.set(chat.id, { id: chat.id, title: chat.title ?? 'Group', type: chat.type })
      }
      return jsonResponse({ botUsername: me.username, chats: [...chats.values()] })
    }

    if (body.action === 'select_chat') {
      const chatId = Number(body.chatId)
      if (!Number.isFinite(chatId)) return jsonResponse({ error: 'Pick a group' }, 400)
      const chat = await tgApi(cfg.token, 'getChat', { chat_id: chatId })
      await sendTelegram(cfg.token, chatId,
        `✅ <b>224 Clubhouse alerts connected</b>\nThis group (${tg(chat.title)}) will now get order, payment, review, membership and delivery alerts, plus the 07:00 daily summary.`)
      const { error } = await admin.rpc('set_telegram_chat', { p_chat_id: chatId, p_title: chat.title ?? 'Group' })
      if (error) return jsonResponse({ error: error.message }, 500)
      return jsonResponse({ success: true, title: chat.title })
    }

    if (body.action === 'test') {
      if (!cfg.chat_id) return jsonResponse({ error: 'Pick a group first' }, 400)
      await sendTelegram(cfg.token, cfg.chat_id, '🔔 <b>Test alert</b> from 224 Clubhouse admin.')
      return jsonResponse({ success: true })
    }

    return jsonResponse({ error: 'Unknown action' }, 400)
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
