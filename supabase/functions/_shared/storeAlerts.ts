import { serviceClient } from './supabaseClients.ts'

// Who gets a store's owner alerts, and what the alert calls the store.
// Recipients come from alert_settings.alert_emails for that store (migration
// 20261107120000). 224 falls back to the ADMIN_ALERT_EMAIL secret, exactly as
// before; any other store with no addresses set gets no email, so a second
// store's orders can never land in 224's inbox.

const ADMIN_ALERT_EMAIL = Deno.env.get('ADMIN_ALERT_EMAIL') ?? ''
export const DEFAULT_TENANT = '224clubhouse'

// Where each store's admin lives, for the "Open admin" links in alerts.
// Interim until store config reaches the functions (multi-store phase 3).
const STORE_SITES: Record<string, string> = {
  '224clubhouse': 'https://224clubhouse.store',
  explosive420: 'https://explosive420.web.app',
}

export interface AlertStore {
  tenant: string
  name: string
  siteUrl: string
  to: string[]
}

const split = (list: string | null | undefined) =>
  (list ?? '').split(',').map(a => a.trim()).filter(Boolean)

/** Never throws: a lookup failure falls back to the store slug and no extra recipients. */
export async function alertStore(tenant: string | null | undefined): Promise<AlertStore> {
  const slug = tenant || DEFAULT_TENANT
  const admin = serviceClient()
  const [{ data: settings }, { data: store }] = await Promise.all([
    admin.from('alert_settings').select('alert_emails').eq('tenant', slug).maybeSingle(),
    admin.from('tenants').select('name').eq('slug', slug).maybeSingle(),
  ])
  const own = split(settings?.alert_emails)
  return {
    tenant: slug,
    name: store?.name ?? slug,
    siteUrl: STORE_SITES[slug] ?? STORE_SITES[DEFAULT_TENANT],
    to: own.length ? own : slug === DEFAULT_TENANT ? split(ADMIN_ALERT_EMAIL) : [],
  }
}
