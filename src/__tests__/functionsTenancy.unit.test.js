/**
 * Static guards on Edge Functions that act for an admin's store.
 *
 * The service role carries no tenant claim, so with no x-tenant header
 * current_tenant() resolves to 224. A function that writes with a bare
 * serviceClient() on behalf of another store's admin therefore writes 224's
 * rows (OPEN_ITEMS.md, "must fix before a second store has an admin"). The
 * functions run on Deno and cannot be imported here, so these tests read the
 * source and pin the pattern that keeps each one in the caller's store.
 *
 *   npx vitest run src/__tests__/functionsTenancy.unit.test.js
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')
const source = (fn) =>
  readFileSync(path.join(ROOT, 'supabase/functions', fn, 'index.ts'), 'utf8').replace(/\r\n/g, '\n')

describe('admin-create-driver stays in the caller\'s store', () => {
  const src = source('admin-create-driver')

  it('resolves the caller\'s store from their JWT and refuses when it cannot', () => {
    expect(src).toMatch(/const tenant = await callerTenant\(authHeader\)/)
    expect(src).toMatch(/if \(!tenant\) return jsonResponse\(/)
  })

  it('creates the login in that store (user_metadata.tenant feeds stamp_user_tenant)', () => {
    expect(src).toMatch(/user_metadata: \{[^}]*\btenant\b[^}]*\}/)
    // app_metadata on createUser would replace the stamp (spec §11).
    expect(src).not.toMatch(/app_metadata:\s*\{/)
  })

  it('refuses to link an existing account that belongs to another store', () => {
    expect(src).toMatch(/existing\.tenant !== tenant/)
  })

  it('writes the drivers row for that store', () => {
    expect(src).toMatch(/const admin = serviceClient\(tenant\)/)
    expect(src).toMatch(/\.from\('drivers'\)[\s\S]*tenant \}/)
  })
})

describe('telegram-connect stays in the caller\'s store', () => {
  const src = source('telegram-connect')

  it('resolves the caller\'s store and refuses when it cannot', () => {
    expect(src).toMatch(/const tenant = await callerTenant\(authHeader\)/)
    expect(src).toMatch(/if \(!tenant\) return jsonResponse\(/)
  })

  it('never calls the Telegram RPCs without the store (that would be 224\'s settings)', () => {
    expect(src).not.toMatch(/serviceClient\(\)/)
    expect(src).toMatch(/serviceClient\(tenant\)\.rpc\('telegram_config'\)/)
    expect(src).toMatch(/const admin = serviceClient\(tenant\)/)
  })
})

// is_admin() only proves the caller administers THEIR store, so every function
// that lets an admin act on a record must also compare the caller's store.
describe('every admin-gated function checks the caller\'s store', () => {
  const fns = ['admin-create-driver', 'geocode-order', 'send-membership-email', 'send-payment-email', 'send-status-email', 'telegram-connect']

  it.each(fns)('%s resolves the caller\'s store', (fn) => {
    const src = source(fn)
    expect(src).toMatch(/callerIsAdmin\(/)
    expect(src).toMatch(/callerTenant\(authHeader\)/)
  })

  it('geocode-order only lets an admin of the order\'s store read or write its map point', () => {
    const src = source('geocode-order')
    expect(src).toMatch(/\.select\('id, tenant,/)
    expect(src).toMatch(/\(await callerTenant\(authHeader\)\) === \(order\.tenant \|\| DEFAULT_STORE\)/)
  })
})
