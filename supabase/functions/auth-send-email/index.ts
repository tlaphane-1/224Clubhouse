import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0'
import { renderAuthEmail, verifyLink } from '../_shared/authEmail.ts'
import { MailError, sendStoreMail } from '../_shared/mail.ts'
import { DEFAULT_STORE, storeFor } from '../_shared/stores.ts'

// Supabase Auth "Send Email Hook" (docs: auth/auth-hooks/send-email-hook).
// Once the hook is switched on in the dashboard, Auth stops using SMTP and the
// supabase/templates files, and calls this for every sign-up confirmation,
// password reset, magic link, email change, invite and reauthentication code.
// Each email is branded and sent as the account's own store (app_metadata.
// tenant, stamped at sign-up), through that store's Resend account. An
// account whose store is unknown gets no email (500), never another store's.
//
// Deploy with --no-verify-jwt: Auth signs the request with the hook secret
// (standard-webhooks), it does not send a user JWT.

const HOOK_SECRET = (Deno.env.get('SEND_EMAIL_HOOK_SECRET') ?? '').replace('v1,whsec_', '')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''

interface HookUser {
  email: string
  new_email?: string
  app_metadata?: Record<string, unknown>
  user_metadata?: Record<string, unknown>
}

interface HookEmailData {
  token: string
  token_hash: string
  redirect_to: string
  email_action_type: string
  site_url: string
  token_new: string
  token_hash_new: string
}

const failure = (status: number, message: string) =>
  new Response(JSON.stringify({ error: { http_code: status, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

serve(async (req) => {
  if (req.method !== 'POST') return failure(405, 'Method not allowed')
  if (!HOOK_SECRET) return failure(500, 'SEND_EMAIL_HOOK_SECRET is not set')

  const payload = await req.text()
  let user: HookUser
  let data: HookEmailData
  try {
    const verified = new Webhook(HOOK_SECRET).verify(payload, Object.fromEntries(req.headers)) as
      { user: HookUser; email_data: HookEmailData }
    user = verified.user
    data = verified.email_data
  } catch {
    return failure(401, 'Invalid signature')
  }

  // app_metadata only: user_metadata is user-editable, and current_tenant()
  // also treats a missing claim as 224. Every account is stamped at creation.
  const tenant = String(user.app_metadata?.tenant ?? '') || DEFAULT_STORE
  const store = storeFor(tenant)
  if (!store) {
    console.error(`[auth-send-email] unknown store "${tenant}" for a ${data.email_action_type} email`)
    return failure(500, 'Unknown store for this account')
  }

  // Each recipient with the link built from its own token hash. With Secure
  // Email Change on, Auth sends two pairs and the hash names are swapped for
  // backward compatibility (docs): the CURRENT address uses token_hash_new,
  // the NEW address uses token_hash.
  const type = data.email_action_type
  const sends: { to: string; tokenHash: string; token: string }[] = []
  if (type === 'email_change' && user.new_email && data.token_hash_new) {
    sends.push({ to: user.email, tokenHash: data.token_hash_new, token: data.token })
    sends.push({ to: user.new_email, tokenHash: data.token_hash, token: data.token_new })
  } else if (type === 'email_change' && user.new_email) {
    sends.push({ to: user.new_email, tokenHash: data.token_hash, token: data.token || data.token_new })
  } else {
    sends.push({ to: user.email, tokenHash: data.token_hash, token: data.token })
  }

  try {
    for (const s of sends) {
      const email = renderAuthEmail(store, {
        type,
        link: s.tokenHash ? verifyLink(SUPABASE_URL, s.tokenHash, type, data.redirect_to || data.site_url) : null,
        token: s.token,
        email: user.email,
        newEmail: user.new_email ?? null,
      }, SUPABASE_URL)
      if (!email) continue
      const sent = await sendStoreMail(store, { sender: 'hello', to: s.to, subject: email.subject, html: email.html })
      if (!sent.sent) return failure(500, sent.reason)
    }
  } catch (e) {
    console.error('[auth-send-email] send failed:', e)
    // Auth retries a hook only on 429/503, so pass Resend's rate limit through.
    if (e instanceof MailError && e.status === 429) return failure(429, 'Email provider rate limited')
    return failure(500, e instanceof Error ? e.message : String(e))
  }

  return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } })
})
