import { escapeHtml } from './escapeHtml.ts'
import { logoUrl, ageLine } from './brand.ts'
import type { Store } from './stores.ts'

// Sign-up, password-reset and other Supabase Auth emails, branded per store.
// Replaces supabase/templates/*.html (one design for every store, 224's
// literals) once the auth-send-email hook is switched on. Same layout and copy
// as those templates, with the store's name, logo, colour and footer.
// Pure: no Deno-only imports, so the unit tests render it too.

export interface AuthEmail {
  subject: string
  html: string
}

const IGNORE = "If you didn't ask for this, you can safely ignore this email."

function button(store: Store, href: string, label: string): string {
  return `
    <div style="text-align:center; margin:32px 0;">
      <a href="${escapeHtml(href)}" style="display:inline-block; background:${store.gold}; color:#0a0a0a; text-decoration:none; padding:14px 32px; border-radius:8px; font-size:13px; font-weight:700; text-transform:uppercase; letter-spacing:2px;">${escapeHtml(label)}</a>
    </div>`
}

function code(store: Store, token: string): string {
  return `
    <div style="text-align:center; margin:28px 0; font-family:monospace; font-size:32px; letter-spacing:8px; color:${store.gold}; font-weight:700;">${escapeHtml(token)}</div>`
}

function page(store: Store, supabaseUrl: string, p: { heading: string; intro: string; action: string; note: string }): string {
  const site = store.siteUrl.replace(/^https?:\/\//, '')
  return `<!DOCTYPE html>
<html>
<body style="margin:0; padding:0; background:#0a0a0a; font-family:Arial, Helvetica, sans-serif;">
  <div style="max-width:560px; margin:0 auto; padding:40px 24px; color:#ffffff;">
    <div style="text-align:center; margin-bottom:32px;">
      <img src="${logoUrl(store, supabaseUrl)}" alt="${escapeHtml(store.name)}" width="200" style="display:inline-block; max-width:200px; height:auto;">
    </div>
    <div style="background:#111111; border:1px solid #222222; border-radius:12px; padding:32px 24px;">
      <h1 style="font-family:Georgia, serif; color:#ffffff; font-size:24px; margin:0 0 16px; text-align:center;">${p.heading}</h1>
      <p style="color:#cccccc; font-size:15px; line-height:1.6; margin:0; text-align:center;">${p.intro}</p>
      ${p.action}
      <p style="color:#888888; font-size:12px; line-height:1.6; margin:0; text-align:center;">${p.note}</p>
    </div>
    <div style="text-align:center; padding-top:28px;">
      <p style="color:#888888; font-size:12px; margin:0 0 4px;">${escapeHtml(store.address)}</p>
      <p style="color:#888888; font-size:12px; margin:0 0 12px;"><a href="${escapeHtml(store.siteUrl)}" style="color:${store.gold}; text-decoration:none;">${escapeHtml(site)}</a> · ${escapeHtml(store.phone)}</p>
      <p style="color:#444444; font-size:11px; margin:0;">${ageLine(store)}</p>
    </div>
  </div>
</body>
</html>
`
}

export interface AuthEmailInput {
  /** email_data.email_action_type from the Send Email Hook payload. */
  type: string
  /** Verify link built from token_hash (null for code-only emails). */
  link: string | null
  /** Six-digit code (reauthentication). */
  token: string
  email: string
  newEmail?: string | null
}

/**
 * The email for one hook call, or null for an action type this project does
 * not send (the hook then answers 200 and nothing goes out).
 */
export function renderAuthEmail(store: Store, input: AuthEmailInput, supabaseUrl: string): AuthEmail | null {
  const n = escapeHtml(store.name)
  const link = input.link ?? ''
  const render = (subject: string, p: { heading: string; intro: string; action: string; note: string }) =>
    ({ subject, html: page(store, supabaseUrl, p) })

  switch (input.type) {
    case 'signup':
      return render(`Confirm your ${store.name} account`, {
        heading: `Welcome to ${n}`,
        intro: 'Thanks for signing up. Confirm your email address to activate your account and start ordering.',
        action: button(store, link, 'Confirm my email'),
        note: `This link expires in 24 hours. ${IGNORE}`,
      })
    case 'recovery':
      return render(`Reset your ${store.name} password`, {
        heading: 'Reset your password',
        intro: `We received a request to reset the password for your ${n} account.`,
        action: button(store, link, 'Choose a new password'),
        note: `This link expires in 1 hour. ${IGNORE}`,
      })
    case 'magiclink':
      return render(`Your ${store.name} sign-in link`, {
        heading: `Sign in to ${n}`,
        intro: 'Use the button below to sign in to your account.',
        action: button(store, link, 'Sign in'),
        note: `This link expires in 1 hour. ${IGNORE}`,
      })
    case 'email_change':
      return render('Confirm your new email address', {
        heading: 'Confirm your new email',
        intro: `Confirm that you want to change your ${n} email from ${escapeHtml(input.email)} to ${escapeHtml(input.newEmail ?? '')}.`,
        action: button(store, link, 'Confirm new email'),
        note: IGNORE,
      })
    case 'invite':
      return render(`You've been invited to ${store.name}`, {
        heading: "You're invited",
        intro: `You've been invited to create an account at ${n}.`,
        action: button(store, link, 'Accept invite'),
        note: IGNORE,
      })
    case 'reauthentication':
      return render(`Your ${store.name} verification code`, {
        heading: 'Confirm it’s you',
        intro: 'Enter this code to continue:',
        action: code(store, input.token),
        note: IGNORE,
      })
    default:
      // 'email' (OTP) and the *_notification types are not used by this
      // project (no OTP sign-in; security notifications are off).
      return null
  }
}

/** GoTrue's verify link (Send Email Hook docs: token = token_hash). */
export function verifyLink(supabaseUrl: string, tokenHash: string, type: string, redirectTo: string): string {
  const params = new URLSearchParams({ token: tokenHash, type, redirect_to: redirectTo })
  return `${supabaseUrl}/auth/v1/verify?${params.toString()}`
}
