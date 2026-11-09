import { STORES } from './stores.generated.ts'

// Each store's email-facing facts (name, logo, address, colours, sender
// domain), generated from tenants/<slug>/tenant.json. Pure data and helpers:
// no Deno-only imports, so the unit tests can load this file too.

export const DEFAULT_STORE = '224clubhouse'

export interface Store {
  slug: string
  name: string
  shortName: string
  siteUrl: string
  logoPath: string
  address: string
  phone: string
  hours: string
  instagram: string | null
  facebook: string | null
  gold: string
  minimumAge: number
  freeDeliveryFromCents: number
  memberFreeDelivery: boolean
  welcomeOffer: boolean
  bankName: string | null
  bankDetails: string | null
  mail: {
    fromDomain: string
    fromDomainEnv: string | null
    resendKeyEnv: string
    bankDetailsEnv: string | null
  }
}

const ALL: Record<string, Store> = STORES as unknown as Record<string, Store>

/**
 * The store a record belongs to. A missing tenant means 224 (rows and
 * accounts from before stores existed); an unknown one is null, and callers
 * must not send rather than borrow another store's branding or sender.
 */
export function storeFor(tenant: string | null | undefined): Store | null {
  return ALL[tenant || DEFAULT_STORE] ?? null
}

export function allStores(): Store[] {
  return Object.values(ALL)
}

export type EnvGet = (name: string) => string | undefined

// deno-lint-ignore no-explicit-any
export const denoEnv: EnvGet = (name) => (globalThis as any).Deno?.env?.get(name) ?? undefined

/** The store's bank details for EFT orders; 224's live secret wins when set. */
export function bankDetailsFor(store: Store, env: EnvGet = denoEnv): string {
  const fromEnv = store.mail.bankDetailsEnv ? env(store.mail.bankDetailsEnv) : undefined
  return (fromEnv || store.bankDetails || '').replace(/\\n/g, '\n').trim()
}
