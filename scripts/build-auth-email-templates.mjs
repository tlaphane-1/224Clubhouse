// Generates the branded Supabase Auth email templates in supabase/templates/.
// Paste each into Dashboard > Authentication > Emails (or wire them via
// [auth.email.template.*] in config.toml). Go-template variables such as
// {{ .ConfirmationURL }} are filled in by Supabase at send time.
// Usage: node scripts/build-auth-email-templates.mjs
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../supabase/templates')
const LOGO = 'https://aogdkqczvlffgydgxsmz.supabase.co/storage/v1/object/public/brand-assets/224-logo-fav-1-480x142.png'

const button = (href, label) => `
    <div style="text-align:center; margin:32px 0;">
      <a href="${href}" style="display:inline-block; background:#C9A84C; color:#0a0a0a; text-decoration:none; padding:14px 32px; border-radius:8px; font-size:13px; font-weight:700; text-transform:uppercase; letter-spacing:2px;">${label}</a>
    </div>`

const page = ({ heading, intro, action, note }) => `<!DOCTYPE html>
<html>
<body style="margin:0; padding:0; background:#0a0a0a; font-family:Arial, Helvetica, sans-serif;">
  <div style="max-width:560px; margin:0 auto; padding:40px 24px; color:#ffffff;">
    <div style="text-align:center; margin-bottom:32px;">
      <img src="${LOGO}" alt="224 Clubhouse" width="200" style="display:inline-block; max-width:200px; height:auto;">
    </div>
    <div style="background:#111111; border:1px solid #222222; border-radius:12px; padding:32px 24px;">
      <h1 style="font-family:Georgia, serif; color:#ffffff; font-size:24px; margin:0 0 16px; text-align:center;">${heading}</h1>
      <p style="color:#cccccc; font-size:15px; line-height:1.6; margin:0; text-align:center;">${intro}</p>
      ${action}
      <p style="color:#888888; font-size:12px; line-height:1.6; margin:0; text-align:center;">${note}</p>
    </div>
    <div style="text-align:center; padding-top:28px;">
      <p style="color:#888888; font-size:12px; margin:0 0 4px;">224 Rondebult Road, Libradene, Boksburg, 1459</p>
      <p style="color:#888888; font-size:12px; margin:0 0 12px;"><a href="https://224clubhouse.store" style="color:#C9A84C; text-decoration:none;">224clubhouse.store</a> · 075 086 8783</p>
      <p style="color:#444444; font-size:11px; margin:0;">🔞 Not for persons under 21</p>
    </div>
  </div>
</body>
</html>
`

const ignore = "If you didn't ask for this, you can safely ignore this email."
const templates = {
  confirmation: {
    subject: 'Confirm your 224 Clubhouse account',
    heading: 'Welcome to 224 Clubhouse',
    intro: 'Thanks for signing up. Confirm your email address to activate your account and start ordering.',
    action: button('{{ .ConfirmationURL }}', 'Confirm my email'),
    note: `This link expires in 24 hours. ${ignore}`,
  },
  recovery: {
    subject: 'Reset your 224 Clubhouse password',
    heading: 'Reset your password',
    intro: 'We received a request to reset the password for your 224 Clubhouse account.',
    action: button('{{ .ConfirmationURL }}', 'Choose a new password'),
    note: `This link expires in 1 hour. ${ignore}`,
  },
  magic_link: {
    subject: 'Your 224 Clubhouse sign-in link',
    heading: 'Sign in to 224 Clubhouse',
    intro: 'Use the button below to sign in to your account.',
    action: button('{{ .ConfirmationURL }}', 'Sign in'),
    note: `This link expires in 1 hour. ${ignore}`,
  },
  email_change: {
    subject: 'Confirm your new email address',
    heading: 'Confirm your new email',
    intro: 'Confirm that you want to change your 224 Clubhouse email from {{ .Email }} to {{ .NewEmail }}.',
    action: button('{{ .ConfirmationURL }}', 'Confirm new email'),
    note: ignore,
  },
  invite: {
    subject: "You've been invited to 224 Clubhouse",
    heading: "You're invited",
    intro: "You've been invited to create an account at 224 Clubhouse.",
    action: button('{{ .ConfirmationURL }}', 'Accept invite'),
    note: ignore,
  },
  reauthentication: {
    subject: 'Your 224 Clubhouse verification code',
    heading: 'Confirm it’s you',
    intro: 'Enter this code to continue:',
    action: `
    <div style="text-align:center; margin:28px 0; font-family:monospace; font-size:32px; letter-spacing:8px; color:#C9A84C; font-weight:700;">{{ .Token }}</div>`,
    note: ignore,
  },
}

mkdirSync(out, { recursive: true })
const subjects = {}
for (const [name, t] of Object.entries(templates)) {
  writeFileSync(path.join(out, `${name}.html`), page(t))
  subjects[name] = t.subject
}
writeFileSync(path.join(out, 'subjects.json'), JSON.stringify(subjects, null, 2) + '\n')
console.log(`wrote ${Object.keys(templates).length} templates to ${out}`)
