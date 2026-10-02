/**
 * Live-DB contract test for newsletter unsubscribe (Layer 1 + 2).
 *
 * Covers migration 20260814100000_newsletter_unsubscribe:
 *   - every subscriber row gets a unique `unsubscribe_token` (default), and
 *     `unsubscribed_at` starts NULL;
 *   - anon CAN call unsubscribe_newsletter with the right token — the link is
 *     clicked from an email client with no session, so this must work logged
 *     out or the legal opt-out is broken;
 *   - a random token returns {success:false, reason:'not_found'} and changes
 *     nothing (no enumeration, no unsubscribing strangers);
 *   - calling twice is idempotent: still success, original timestamp kept;
 *   - anon still cannot SELECT newsletter_subscribers (PII negative control —
 *     the table has an admin-only select policy and the unsubscribe token must
 *     never be readable, or anyone could opt the whole list out);
 *   - anon cannot UPDATE the table directly either — the definer RPC is the
 *     only write path.
 *
 * Plus migration 20260814110000 (FIX 1):
 *   - email is stored normalised, so a re-subscribe with different casing
 *     lands on the SAME row instead of creating a duplicate that would be
 *     mailed twice and only half opted-out. That case is gated on its own
 *     probe and skips if only 20260814100000 is live.
 *
 * REQUIRES migration 20260814100000. The probe uses the SERVICE-ROLE client
 * (which bypasses RLS, so a missing column is the only thing that can fail).
 * `probeMigration` separates that clean absence from a broken probe — the old
 * `MIGRATED = !error` form turned a transient blip into a silent green skip of
 * the whole opt-out contract.
 *
 * ISOLATION: both subscriber addresses carry RUN_TAG, so a concurrent or
 * orphaned vitest run cannot delete the row this suite is asserting on.
 *
 * Auto-skips unless BOTH VITE_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY
 * are set (service role is required for setup + safe cleanup).
 *
 * How to run (PowerShell):
 *   npx vitest run src/__tests__/newsletter.contract.test.js
 */
import { describe, it, expect, afterAll } from 'vitest'
import {
  anonClient, serviceClient, probeMigration, describeGate, RUN_TAG,
} from './helpers/liveFixtures.js'

const gate = await probeMigration({
  migration: '20260814100000_newsletter_unsubscribe',
  label: 'newsletter_subscribers.unsubscribe_token',
  probe: () => serviceClient()
    .from('newsletter_subscribers')
    .select('unsubscribe_token, unsubscribed_at')
    .limit(1),
})
const SKIP = !gate.applied

// 20260814110000's email normalisation is a trigger plus a data backfill —
// neither is visible through PostgREST — so it ships a marker function.
let FIXES_MIGRATED = false
if (!SKIP) {
  const { data, error } = await serviceClient().rpc('discount_newsletter_fixes_applied')
  FIXES_MIGRATED = !error && data === true
}

// Run-tagged identities so cleanup targets exactly our rows and no other run's.
const TEST_EMAIL = `vitest+newsletter-${RUN_TAG}@example.com`
// A second identity for the case-normalisation case. Stored form is the
// lowercase one; the other two spellings are what a visitor might type.
const CASE_EMAIL_LOWER = `vitest+newsletter.case-${RUN_TAG}@example.com`
const CASE_EMAIL_MIXED = `ViTest+Newsletter.Case-${RUN_TAG}@Example.COM`
const CASE_EMAIL_TYPED = `  VITEST+newsletter.CASE-${RUN_TAG}@example.com `
// A syntactically valid UUID that is not in the table.
const RANDOM_TOKEN = '00000000-0000-4000-8000-0000000c0ffe'

const anon = SKIP ? null : anonClient()
const admin = SKIP ? null : serviceClient()

// Shared state across the ordered tests.
let token = null
let firstUnsubscribedAt = null

describe.skipIf(SKIP)('Newsletter contract — token-based unsubscribe', () => {
  afterAll(async () => {
    if (!admin) return
    await admin
      .from('newsletter_subscribers')
      .delete()
      .in('email', [TEST_EMAIL, CASE_EMAIL_LOWER, CASE_EMAIL_MIXED, CASE_EMAIL_TYPED.trim()])
  })

  it('POSITIVE: a new subscriber row is created with a token and no opt-out', async () => {
    const { data, error } = await admin
      .from('newsletter_subscribers')
      .insert({ email: TEST_EMAIL, first_name: 'Vitest', last_name: 'Subscriber' })
      .select('unsubscribe_token, unsubscribed_at')
      .single()

    expect(error).toBeNull()
    expect(data.unsubscribed_at).toBeNull()
    expect(data.unsubscribe_token).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
    token = data.unsubscribe_token
  })

  it('NEGATIVE: anon cannot read newsletter_subscribers (PII + the token itself)', async () => {
    const { data, error } = await anon
      .from('newsletter_subscribers')
      .select('email, unsubscribe_token')
      .eq('email', TEST_EMAIL)
    // RLS returns an empty set rather than an error; either is acceptable, a
    // leaked row is not. The row demonstrably exists (inserted above), so an
    // empty result here proves the policy is doing the work.
    expect(error != null || (data?.length ?? 0) === 0).toBe(true)
  })

  it('NEGATIVE: a random token returns not_found and changes nothing', async () => {
    const { data, error } = await anon.rpc('unsubscribe_newsletter', {
      p_token: RANDOM_TOKEN,
    })
    expect(error).toBeNull()
    expect(data).toEqual({ success: false, reason: 'not_found' })
    // Response carries no hint about whether the token exists — no email, no
    // count, nothing to enumerate with.
    expect(data.email).toBeUndefined()

    const { data: row } = await admin
      .from('newsletter_subscribers')
      .select('unsubscribed_at')
      .eq('email', TEST_EMAIL)
      .single()
    expect(row?.unsubscribed_at).toBeNull()
  })

  it('NEGATIVE: anon cannot flip unsubscribed_at by writing the table directly', async () => {
    const { data, error } = await anon
      .from('newsletter_subscribers')
      .update({ unsubscribed_at: new Date().toISOString() })
      .eq('email', TEST_EMAIL)
      .select('email')
    // No update policy exists, so the write matches zero rows (or errors).
    expect(error != null || (data?.length ?? 0) === 0).toBe(true)

    const { data: row } = await admin
      .from('newsletter_subscribers')
      .select('unsubscribed_at')
      .eq('email', TEST_EMAIL)
      .single()
    expect(row?.unsubscribed_at).toBeNull()
  })

  it('POSITIVE: anon unsubscribes with the correct token (link clicked while logged out)', async () => {
    expect(token).toBeTruthy()
    const { data, error } = await anon.rpc('unsubscribe_newsletter', { p_token: token })
    expect(error).toBeNull()
    expect(data.success).toBe(true)
    expect(data.email).toBe(TEST_EMAIL)

    const { data: row } = await admin
      .from('newsletter_subscribers')
      .select('unsubscribed_at')
      .eq('email', TEST_EMAIL)
      .single()
    expect(row?.unsubscribed_at).not.toBeNull()
    firstUnsubscribedAt = row.unsubscribed_at
  })

  it('POSITIVE: unsubscribing twice is idempotent — still success, original timestamp kept', async () => {
    expect(firstUnsubscribedAt).toBeTruthy()
    const { data, error } = await anon.rpc('unsubscribe_newsletter', { p_token: token })
    expect(error).toBeNull()
    expect(data.success).toBe(true)
    expect(data.email).toBe(TEST_EMAIL)

    const { data: row } = await admin
      .from('newsletter_subscribers')
      .select('unsubscribed_at')
      .eq('email', TEST_EMAIL)
      .single()
    expect(row?.unsubscribed_at).toBe(firstUnsubscribedAt)
  })

  // Covers migration 20260814110000 (FIX 1). Gated on its own probe so the
  // file still runs green against a DB that has 20260814100000 but not the
  // follow-up.
  it.skipIf(!FIXES_MIGRATED)(
    'POSITIVE: a mixed-case address re-subscribes into the SAME row (no duplicate, opt-out stays intact)',
    async () => {
      // 1. The legacy shape, as far as it can still be produced: a DIRECT
      //    insert — "newsletter_public_insert" is still on the table — with the
      //    address exactly as a visitor typed it. The normalising trigger
      //    lowercases it on the way in; that is the drift guard.
      const { data: inserted, error: insErr } = await admin
        .from('newsletter_subscribers')
        .insert({ email: CASE_EMAIL_MIXED, first_name: 'Vitest' })
        .select('id, email, unsubscribe_token')
        .single()
      expect(insErr).toBeNull()
      expect(inserted.email).toBe(CASE_EMAIL_LOWER)

      // 2. Opt out, so the re-subscribe below has something to undo.
      const { data: out, error: outErr } = await anon.rpc('unsubscribe_newsletter', {
        p_token: inserted.unsubscribe_token,
      })
      expect(outErr).toBeNull()
      expect(out.success).toBe(true)

      // 3. Re-subscribe with a THIRD spelling (and stray whitespace). Before
      //    this migration a mixed-case stored value meant subscribe_newsletter's
      //    `on conflict (email)` missed and a SECOND row was created: two
      //    tokens, two copies of every campaign, and unsubscribing one leaving
      //    the other on the list.
      const { data: sub, error: subErr } = await anon.rpc('subscribe_newsletter', {
        p_email: CASE_EMAIL_TYPED,
      })
      expect(subErr).toBeNull()
      expect(sub.success).toBe(true)
      expect(sub.email).toBe(CASE_EMAIL_LOWER)

      // 4. ONE row, the same one, reactivated — and the name already on file
      //    was not blanked by the empty re-subscribe form.
      const { data: rows, error: rowsErr } = await admin
        .from('newsletter_subscribers')
        .select('id, email, unsubscribed_at, first_name')
        .in('email', [CASE_EMAIL_LOWER, CASE_EMAIL_MIXED, CASE_EMAIL_TYPED.trim()])
      expect(rowsErr).toBeNull()
      expect(rows).toHaveLength(1)
      expect(rows[0].id).toBe(inserted.id)
      expect(rows[0].email).toBe(CASE_EMAIL_LOWER)
      expect(rows[0].unsubscribed_at).toBeNull()
      expect(rows[0].first_name).toBe('Vitest')
    },
  )
})

describeGate('Newsletter contract', gate)

describe.skipIf(SKIP || FIXES_MIGRATED)(
  'Newsletter email-normalisation case skipped (migration 20260814110000_discount_newsletter_fixes not applied — run `supabase db push`)',
  () => {
    it('reminds devs why the mixed-case re-subscribe case is skipped', () => {
      expect(true).toBe(true)
    })
  },
)
