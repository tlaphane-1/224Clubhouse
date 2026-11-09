/**
 * Auth emails (sign-up confirmation, password reset, …) rendered per store by
 * supabase/functions/_shared/authEmail.ts for the auth-send-email hook.
 * No database, no network.
 *
 *   npx vitest run src/__tests__/authEmail.unit.test.js
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { renderAuthEmail, renderDriverWelcome, verifyLink } from '../../supabase/functions/_shared/authEmail.ts'
import { storeFor } from '../../supabase/functions/_shared/stores.ts'

const SUPABASE = 'https://project.supabase.co'
const S224 = storeFor('224clubhouse')
const E420 = storeFor('explosive420')
const LINK = verifyLink(SUPABASE, 'hash123', 'signup', 'https://explosive420.web.app/checkout')
const input = (type, extra = {}) => ({ type, link: LINK, token: '123456', email: 'a@example.com', ...extra })

describe('verifyLink', () => {
  it('is GoTrue\'s verify endpoint with the token HASH, type and redirect', () => {
    const url = new URL(LINK)
    expect(url.origin + url.pathname).toBe(`${SUPABASE}/auth/v1/verify`)
    expect(url.searchParams.get('token')).toBe('hash123')
    expect(url.searchParams.get('type')).toBe('signup')
    expect(url.searchParams.get('redirect_to')).toBe('https://explosive420.web.app/checkout')
  })
})

describe('renderAuthEmail', () => {
  it('224 keeps its current subjects and wording', () => {
    const subjects = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../../supabase/templates/subjects.json'), 'utf8'))
    const types = { confirmation: 'signup', recovery: 'recovery', magic_link: 'magiclink', email_change: 'email_change', invite: 'invite', reauthentication: 'reauthentication' }
    for (const [template, type] of Object.entries(types)) {
      expect(renderAuthEmail(S224, input(type), SUPABASE).subject, type).toBe(subjects[template])
    }
    const html = renderAuthEmail(S224, input('signup'), SUPABASE).html
    expect(html).toContain('Welcome to 224 Clubhouse')
    expect(html).toContain('224 Rondebult Road, Libradene, Boksburg, 1459')
    expect(html).toContain('224-logo-fav-1-480x142.png')
    expect(html).toContain('#C9A84C')
  })

  it('Explosive 420 gets its own name, logo, colour and address, and nothing of 224', () => {
    for (const type of ['signup', 'recovery', 'magiclink', 'email_change', 'invite', 'reauthentication']) {
      const { subject, html } = renderAuthEmail(E420, input(type, { newEmail: 'b@example.com' }), SUPABASE)
      expect(`${subject}\n${html}`, type).not.toMatch(/224|Rondebult|#C9A84C/)
      if (type !== 'email_change') expect(subject, type).toContain('Explosive 420')
      expect(html, type).toContain('e420-logo-wide.png')
      expect(html, type).toContain('#F5C518')
      expect(html, type).toContain('702 Aubrey Matlakala St')
    }
  })

  it('puts the link in the button, and the code in a reauthentication email', () => {
    expect(renderAuthEmail(E420, input('signup'), SUPABASE).html).toContain(LINK.replace(/&/g, '&amp;'))
    expect(renderAuthEmail(E420, input('reauthentication'), SUPABASE).html).toContain('123456')
  })

  it('escapes addresses in the email-change copy', () => {
    const html = renderAuthEmail(E420, input('email_change', { email: '<b>x</b>@e.com', newEmail: 'y@e.com' }), SUPABASE).html
    expect(html).not.toContain('<b>x</b>')
  })

  it('sends nothing for action types the project does not use', () => {
    expect(renderAuthEmail(E420, input('password_changed_notification'), SUPABASE)).toBeNull()
  })
})

describe('renderDriverWelcome', () => {
  const link = 'https://project.supabase.co/auth/v1/verify?token=abc&type=recovery'

  it("welcomes the driver by first name in the store's branding, with the portal address", () => {
    const { subject, html } = renderDriverWelcome(E420, { link, fullName: 'Mpho Mphahlele' }, SUPABASE)
    expect(subject).toBe("You've been added as a driver for Explosive 420 Cannabis Social Club")
    expect(html).toContain('Welcome, Mpho')
    expect(html).toContain('explosive420.co.za/driver')
    expect(html).toContain('Choose my password')
    expect(html).toContain(link.replace(/&/g, '&amp;'))
    expect(html).not.toContain('224')
  })

  it("escapes the driver's name", () => {
    const { html } = renderDriverWelcome(E420, { link, fullName: '<img src=x>' }, SUPABASE)
    expect(html).not.toContain('<img src=x>')
  })
})

describe('auth-send-email hook', () => {
  const src = readFileSync(path.resolve(import.meta.dirname, '../../supabase/functions/auth-send-email/index.ts'), 'utf8')

  it('verifies the standard-webhooks signature on the raw body before using it', () => {
    expect(src).toMatch(/const payload = await req\.text\(\)/)
    expect(src).toMatch(/new Webhook\(HOOK_SECRET\)\.verify\(payload,/)
    expect(src).toMatch(/return failure\(401/)
  })

  it('picks the account\'s store and refuses an unknown one rather than borrowing another', () => {
    expect(src).toMatch(/user\.app_metadata\?\.tenant/)
    // user_metadata is user-editable; a missing claim means 224, as in current_tenant().
    expect(src).not.toMatch(/user_metadata\?\.tenant/)
    expect(src).toMatch(/if \(!store\)[\s\S]{0,200}return failure\(500/)
  })

  it('passes a Resend rate limit through as 429, the only status Auth retries besides 503', () => {
    expect(src).toMatch(/e instanceof MailError && e\.status === 429\) return failure\(429/)
  })

  it('is reachable without a user JWT even if a deploy forgets --no-verify-jwt', () => {
    const toml = readFileSync(path.resolve(import.meta.dirname, '../../supabase/config.toml'), 'utf8').replace(/\r\n/g, '\n')
    for (const fn of ['auth-send-email', 'send-cart-reminders', 'send-daily-summary']) {
      expect(toml).toMatch(new RegExp(`\\[functions\\.${fn}\\]\\nverify_jwt = false`))
    }
  })
})
