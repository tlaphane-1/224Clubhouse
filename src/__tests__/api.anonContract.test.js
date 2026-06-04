/**
 * Live-DB contract test from the ANON (unauthenticated) role's
 * perspective (Layer 2 — RLS/auth gating).
 *
 * Layer 1 (api.contract.test.js) uses the service-role key, which
 * BYPASSES RLS — so it proves the schema is intact but says nothing
 * about what a real, logged-out browser visitor can actually read.
 * This spec uses the public anon key and asserts the RLS posture:
 *
 *   POSITIVE controls — anon CAN read the public storefront tables
 *   (products, events). If a future migration drops their public
 *   SELECT policy the storefront silently goes blank; these tests
 *   catch that.
 *
 *   NEGATIVE controls — the high-value tests. orders, memberships and
 *   newsletter_subscribers carry PII (including POPIA-sensitive ID
 *   numbers on memberships). Anon must NEVER see a populated row. The
 *   assertion tolerates the table being empty or erroring; the only
 *   outcome that fails is leaked rows.
 *
 * NOTE: this app has NO PostgREST embeds and NO SECURITY DEFINER embed
 * RPC, so the reference implementation's "direct embed still blanks the
 * foreign row" negative control is N/A here. The applicable negative
 * controls are the flat-table RLS-visibility checks below.
 *
 * This layer is strictly READ-ONLY — no inserts (memberships/newsletter
 * have public INSERT policies, but exercising them would pollute the DB).
 *
 * Auto-skips when VITE_SUPABASE_ANON_KEY isn't set.
 *
 * How to run (PowerShell):
 *   $env:VITE_SUPABASE_ANON_KEY='...'
 *   npx vitest run src/__tests__/api.anonContract.test.js
 */
import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const URL =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  'https://aogdkqczvlffgydgxsmz.supabase.co'
const ANON = process.env.VITE_SUPABASE_ANON_KEY
const SKIP = !ANON

const supabase = SKIP
  ? null
  : createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } })

describe.skipIf(SKIP)('Anon-role contract — public storefront reads work', () => {
  it('POSITIVE: anon can read products (public SELECT)', async () => {
    const { data, error } = await supabase.from('products').select('*').limit(1)
    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
  })

  it('POSITIVE: anon can read events (public SELECT)', async () => {
    const { data, error } = await supabase.from('events').select('*').limit(1)
    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
  })
})

// ── PII negative controls — the highest-value tests in the suite ─────────
// orders / memberships / newsletter_subscribers are authenticated-read
// only. Anon must never see a populated row. Tolerant of an empty table
// or an outright RLS error — the ONLY failure that matters is leaked rows.
describe.skipIf(SKIP)('Anon-role contract — PII tables stay hidden', () => {
  it('NEGATIVE: anon cannot read orders rows', async () => {
    const { data, error } = await supabase
      .from('orders')
      .select('customer_email')
      .limit(5)
    expect(error != null || (data?.length ?? 0) === 0).toBe(true)
  })

  it('NEGATIVE: anon cannot read memberships rows (POPIA: id_number)', async () => {
    const { data, error } = await supabase
      .from('memberships')
      .select('id_number')
      .limit(5)
    expect(error != null || (data?.length ?? 0) === 0).toBe(true)
  })

  it('NEGATIVE: anon cannot read newsletter_subscribers rows', async () => {
    const { data, error } = await supabase
      .from('newsletter_subscribers')
      .select('email')
      .limit(5)
    expect(error != null || (data?.length ?? 0) === 0).toBe(true)
  })
})

describe.skipIf(!SKIP)('Anon-role contract skipped (no VITE_SUPABASE_ANON_KEY)', () => {
  it('reminds devs how to enable the anon-role contract test', () => {
    expect(true).toBe(true)
  })
})
