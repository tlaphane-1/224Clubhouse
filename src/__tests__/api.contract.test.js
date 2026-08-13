/**
 * LIVE-DB API contract test (Layer 1 — service-role).
 *
 * Hits the REAL remote Supabase DB with the service-role key and runs
 * every read query that lives in src/hooks/*.js. Service role bypasses
 * RLS, so this layer validates SCHEMA/SHAPE, not permissions:
 *   - a renamed/dropped column referenced in an older .select()
 *   - a missing column after a partially-applied migration
 *   - a stale PostgREST schema-cache mismatch
 *
 * It intentionally does NOT assert row counts (those drift with real
 * data) and does NOT mutate anything. Every probe uses .limit(0) so no
 * seeded data is required — PostgREST still validates the column list.
 *
 * NOTE: this app has NO PostgREST embeds — every hook does a flat
 * .select('*'). So unlike the reference implementation there is no
 * embed-ambiguity ("more than one relationship") negative control here;
 * Layer 3 (rlsEmbedAudit) guards that 0-embed invariant statically.
 *
 * How to run (PowerShell):
 *   $env:SUPABASE_SERVICE_ROLE_KEY='...'
 *   npx vitest run src/__tests__/api.contract.test.js
 *
 * Auto-skips when SUPABASE_SERVICE_ROLE_KEY isn't set, so PR builds
 * without the secret stay green.
 */
import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const URL =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  'https://aogdkqczvlffgydgxsmz.supabase.co'
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const SKIP = !KEY

const FAKE_UUID = '00000000-0000-0000-0000-000000000000'
const TODAY = new Date().toISOString().split('T')[0]

// Vitest still evaluates the describe body during discovery even when
// skipIf is true, so we must avoid constructing the client when KEY is
// missing — createClient throws "supabaseKey is required" otherwise.
describe.skipIf(SKIP)('API contract — read queries resolve against live DB', () => {
  const supabase = KEY
    ? createClient(URL, KEY, { auth: { autoRefreshToken: false, persistSession: false } })
    : null

  // One probe per read path in src/hooks/*.js. .limit(0) means we don't
  // need data on the row — only the column list is validated. Fake
  // filter values are fine; PostgREST validates the projection regardless.
  const PROBES = [
    // useProducts() — available products, newest first
    { name: 'useProducts (available, newest)', run: () => supabase.from('products').select('*').eq('is_available', true).order('created_at', { ascending: false }).limit(0) },
    // useProducts(category) — category filter branch
    { name: 'useProducts by category', run: () => supabase.from('products').select('*').eq('category', 'flower').limit(0) },
    // useProduct(slug) — .single() dropped in the probe (limit(0) returns 0 rows)
    { name: 'useProduct by slug', run: () => supabase.from('products').select('*').eq('slug', '__none__').limit(0) },
    // useAllProducts() — admin, all products
    { name: 'useAllProducts', run: () => supabase.from('products').select('*').order('created_at', { ascending: false }).limit(0) },

    // useEvents() — upcoming events
    { name: 'useEvents (upcoming)', run: () => supabase.from('events').select('*').gte('date', TODAY).order('date', { ascending: true }).limit(0) },
    // useAllEvents() — admin, all events
    { name: 'useAllEvents', run: () => supabase.from('events').select('*').order('date', { ascending: false }).limit(0) },

    // useOrders() — admin, all orders
    { name: 'useOrders', run: () => supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(0) },
    // useOrder(id) — single order by id (.single() dropped)
    { name: 'useOrder by id', run: () => supabase.from('orders').select('*').eq('id', FAKE_UUID).limit(0) },

    // useMemberships() — admin, all memberships
    { name: 'useMemberships', run: () => supabase.from('memberships').select('*').order('created_at', { ascending: false }).limit(0) },

    // useContactMessages() — admin, all contact-form messages
    { name: 'useContactMessages', run: () => supabase.from('contact_messages').select('*').order('created_at', { ascending: false }).limit(0) },
  ]

  PROBES.forEach(({ name, run }) => {
    it(`${name} — columns resolve`, async () => {
      const { error } = await run()
      // We don't assert on data — it can legitimately be [] for limit(0)
      // or fake filters. We only fail if PostgREST refused the query.
      if (error) {
        throw new Error(
          `${name}: ${error.code || ''} ${error.message}\n` +
          `details: ${error.details || ''}\n` +
          `hint:    ${error.hint || ''}`
        )
      }
    })
  })
})

describe.skipIf(!SKIP)('API contract test skipped (no SUPABASE_SERVICE_ROLE_KEY)', () => {
  it('reminds devs how to enable the live-DB contract test', () => {
    // No-op placeholder so CI surfaces the skip reason.
    expect(true).toBe(true)
  })
})
