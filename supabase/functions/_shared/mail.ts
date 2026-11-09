import { denoEnv, type EnvGet, type Store } from './stores.ts'

// The ONE place that talks to Resend. Every email goes out from the store it
// is about: that store's name, its own sending domain and the Resend key its
// config names (today both stores share one Resend account, so the same key;
// a store can move to its own account by naming another key). A store whose key is not set sends
// nothing and says so; it never falls back to another store's key or domain,
// so one store's mail can never leave from another's address.
// src/__tests__/functionStores.unit.test.js checks every function sends
// through here.

export type Sender = 'orders' | 'hello'

export interface MailParts {
  sender: Sender
  to: string | string[]
  subject: string
  html: string
  // Extra email headers (e.g. List-Unsubscribe), passed to Resend as-is.
  headers?: Record<string, string>
}

export type SendResult =
  | { sent: true; id: string | null }
  | { sent: false; reason: string }

/** Resend refused the message; status is Resend's HTTP status (429 = rate limited). */
export class MailError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export interface MailDeps {
  env?: EnvGet
  fetchImpl?: typeof fetch
}

/** The domain this store sends from. 224's MAIL_FROM_DOMAIN secret wins when set. */
export function fromDomainFor(store: Store, env: EnvGet = denoEnv): string {
  const override = store.mail.fromDomainEnv ? env(store.mail.fromDomainEnv) : undefined
  return override || store.mail.fromDomain
}

export function fromAddress(store: Store, sender: Sender, env: EnvGet = denoEnv): string {
  return `${store.name} <${sender}@${fromDomainFor(store, env)}>`
}

/**
 * Sends one email for `store`. Resolves `{ sent: false }` when the store has
 * no Resend key (logged); throws when Resend refuses the message, as the
 * callers did before, so each caller keeps its own failure handling.
 */
export async function sendStoreMail(store: Store, parts: MailParts, deps: MailDeps = {}): Promise<SendResult> {
  const env = deps.env ?? denoEnv
  const fetchImpl = deps.fetchImpl ?? fetch
  const key = env(store.mail.resendKeyEnv) ?? ''
  if (!key) {
    const reason = `skipped: ${store.mail.resendKeyEnv} is not set for ${store.slug}`
    console.error(`[mail] ${reason}`)
    return { sent: false, reason }
  }
  const res = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: fromAddress(store, parts.sender, env),
      to: parts.to,
      subject: parts.subject,
      html: parts.html,
      ...(parts.headers ? { headers: parts.headers } : {}),
    }),
  })
  if (!res.ok) throw new MailError(res.status, await res.text())
  const body = await res.json().catch(() => ({}))
  return { sent: true, id: body?.id ?? null }
}
