/**
 * The Edge Functions' per-store data and mailer. No database, no network.
 *
 *   1. supabase/functions/_shared/stores.generated.ts matches tenants/*.
 *   2. Spec §5.7 rule: a message's from-domain is the recipient store's own
 *      sending domain, and its own Resend key is used — never another store's,
 *      even when that store's key or override is the only one set.
 *
 *   npx vitest run src/__tests__/functionStores.unit.test.js
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { generateStoresModule, storeSlugs, OUT } from '../../scripts/build-function-stores.mjs'
import { sendStoreMail, fromDomainFor } from '../../supabase/functions/_shared/mail.ts'
import { storeFor, allStores, bankDetailsFor } from '../../supabase/functions/_shared/stores.ts'

describe('stores.generated.ts', () => {
  it('is in sync with tenants/*/tenant.json (run node scripts/build-function-stores.mjs)', () => {
    const onDisk = readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n')
    expect(onDisk).toBe(generateStoresModule())
  })

  it('has every store, and no two stores share a sending domain or Resend key', () => {
    expect(allStores().map(s => s.slug).sort()).toEqual(storeSlugs())
    const domains = allStores().map(s => s.mail.fromDomain)
    const keys = allStores().map(s => s.mail.resendKeyEnv)
    expect(new Set(domains).size).toBe(domains.length)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('treats a missing tenant as 224 and an unknown one as no store', () => {
    expect(storeFor(null)?.slug).toBe('224clubhouse')
    expect(storeFor('no-such-store')).toBeNull()
  })
})

// Two fake stores, so the rule is tested independently of the real configs.
const fakeStore = (slug, domain, keyEnv, domainEnv = null) => ({
  slug, name: `Store ${slug}`, shortName: slug, siteUrl: `https://${slug}.test`,
  logoPath: `brand-assets/${slug}.png`, address: 'x', phone: 'x', hours: 'x',
  instagram: null, facebook: null, gold: '#000000', minimumAge: 21, bankDetails: null,
  mail: { fromDomain: domain, fromDomainEnv: domainEnv, resendKeyEnv: keyEnv, bankDetailsEnv: null },
})
const A = fakeStore('store-a', 'a-mail.test', 'KEY_A', 'DOMAIN_A')
const B = fakeStore('store-b', 'b-mail.test', 'KEY_B')

function fakeResend() {
  const calls = []
  const fetchImpl = vi.fn(async (_url, init) => {
    calls.push({ auth: init.headers.Authorization, body: JSON.parse(init.body) })
    return new Response(JSON.stringify({ id: 'msg_1' }), { status: 200 })
  })
  return { calls, fetchImpl }
}
const envOf = (vars) => (name) => vars[name]
const domainOf = (from) => from.match(/@([^>]+)>$/)[1]

describe('mail: a store only sends as itself', () => {
  const stores = [A, B, storeFor('224clubhouse'), storeFor('explosive420')]
  const env = envOf({ KEY_A: 'key-a', KEY_B: 'key-b', RESEND_API_KEY: 'key-224', RESEND_API_KEY_EXPLOSIVE420: 'key-e420' })

  for (const store of stores) {
    for (const sender of ['orders', 'hello']) {
      it(`${store.slug} ${sender}@ goes out from its own domain with its own key`, async () => {
        const { calls, fetchImpl } = fakeResend()
        const res = await sendStoreMail(store, { sender, to: 'c@example.com', subject: 's', html: 'h' }, { env, fetchImpl })
        expect(res).toEqual({ sent: true, id: 'msg_1' })
        expect(domainOf(calls[0].body.from)).toBe(store.mail.fromDomain)
        expect(calls[0].body.from).toBe(`${store.name} <${sender}@${store.mail.fromDomain}>`)
        expect(calls[0].auth).toBe(`Bearer ${env(store.mail.resendKeyEnv)}`)
      })
    }
  }

  it('a store without its own key sends nothing, even when another store\'s key is set', async () => {
    const { calls, fetchImpl } = fakeResend()
    const res = await sendStoreMail(B, { sender: 'orders', to: 'c@example.com', subject: 's', html: 'h' },
      { env: envOf({ KEY_A: 'key-a', RESEND_API_KEY: 'key-224' }), fetchImpl })
    expect(res.sent).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('only the store that names a domain override reads it', () => {
    const env2 = envOf({ DOMAIN_A: 'override-a.test', MAIL_FROM_DOMAIN: '224-override.test' })
    expect(fromDomainFor(A, env2)).toBe('override-a.test')
    expect(fromDomainFor(B, env2)).toBe('b-mail.test')
    // 224's live MAIL_FROM_DOMAIN secret keeps working; Explosive 420 never sees it.
    expect(fromDomainFor(storeFor('224clubhouse'), env2)).toBe('224-override.test')
    expect(fromDomainFor(storeFor('explosive420'), env2)).toBe('explosive420.co.za')
  })

  it('a Resend refusal throws, as the callers expect', async () => {
    const fetchImpl = async () => new Response('domain not verified', { status: 403 })
    await expect(sendStoreMail(A, { sender: 'orders', to: 'c@example.com', subject: 's', html: 'h' },
      { env, fetchImpl })).rejects.toThrow(/domain not verified/)
  })
})

describe('bank details', () => {
  it('224 prefers its EFT_BANK_DETAILS secret; a store without bank details has none', () => {
    const env = envOf({ EFT_BANK_DETAILS: 'Bank: Secret\\nAcc: 1' })
    expect(bankDetailsFor(storeFor('224clubhouse'), env)).toBe('Bank: Secret\nAcc: 1')
    expect(bankDetailsFor(storeFor('224clubhouse'), envOf({}))).toMatch(/^Bank: FNB/)
    expect(bankDetailsFor(storeFor('explosive420'), env)).toBe('')
  })
})
