import { renderDriverWelcome } from './authEmail.ts'
import { sendStoreMail, type SendResult } from './mail.ts'
import type { Store } from './stores.ts'
import { serviceClient } from './supabaseClients.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''

/**
 * Emails a driver a link to choose their password and open the driver portal.
 * The caller must already have checked that the driver belongs to `store`.
 *
 * generateLink only mints the link (no email, so the auth hook is not
 * involved); the email goes out through sendStoreMail in the store's branding.
 * Throws when the link cannot be made or Resend refuses the message.
 */
export async function sendDriverWelcome(store: Store, driver: { email: string; fullName: string }): Promise<SendResult> {
  const { data, error } = await serviceClient(store.slug).auth.admin.generateLink({
    type: 'recovery',
    email: driver.email,
    options: { redirectTo: `${store.siteUrl}/reset-password` },
  })
  const link = data?.properties?.action_link
  if (error || !link) throw new Error(`Could not make the sign-in link: ${error?.message ?? 'no link returned'}`)
  const email = renderDriverWelcome(store, { link, fullName: driver.fullName }, SUPABASE_URL)
  return sendStoreMail(store, { sender: 'hello', to: driver.email, subject: email.subject, html: email.html })
}
