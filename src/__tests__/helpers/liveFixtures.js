/**
 * Shared plumbing for the live-DB contract suites (Layers 1 + 2).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS — the flakiness this file fixes
 * ---------------------------------------------------------------------------
 * Every contract suite used to name its fixtures with FIXED, run-independent
 * identifiers: `vitest+cod@example.com`, slug `vitest-restock-product`, event
 * titles `Vitest Event —%`, code `VITEST-DISCOUNT`. Each suite then opened its
 * `beforeAll` by DELETING everything matching those names, to clear leftovers
 * from a previous crashed run.
 *
 * That is safe for one run at a time and catastrophic for two. If a second
 * vitest process is alive — a colleague running the suite, CI overlapping a
 * local run, or (the common case here) an ORPHANED worker left behind when a
 * previous run was Ctrl-C'd or killed by a CI/shell timeout — then run B's
 * `beforeAll` purge deletes run A's live fixtures mid-test: the auth user A is
 * signed in as, the product A is ordering, the events A is reserving. A then
 * fails in scattered, irreproducible ways, and because the two runs also block
 * each other on row locks, durations balloon from ~10s per file to 40-50s.
 * Orphaned workers survive for a long time (one was measured holding an open
 * `DELETE /events` for 46 minutes), so a single interrupted run poisons every
 * run after it — which is exactly why the failures showed up "back to back"
 * and never in a single file run on its own.
 *
 * The fix is namespacing, not retries: every mutable fixture a suite creates is
 * tagged with RUN_TAG, unique to this process. Two runs can no longer see, let
 * alone delete, each other's rows. Nothing is purged by prefix at suite start.
 *
 * Leftovers from crashed runs are reaped instead by `sweepStaleFixtures`, run
 * ONCE per vitest run from `test/globalSetup.mjs`, and only against rows older
 * than STALE_AFTER_MS. A live run finishes in ~70s, so the sweeper can never
 * race a concurrent run's fixtures.
 *
 * ---------------------------------------------------------------------------
 * WHAT WAS RULED OUT
 * ---------------------------------------------------------------------------
 * GoTrue rate limiting. Measured directly: 6 admin `createUser` + 14
 * consecutive `signInWithPassword` calls against this project all returned 200
 * in ~300ms each, with no 429 and no rate-limit headers. Auth throughput is not
 * the constraint. `createTestUser` still backs off on 429 because a shared
 * project could hit the limit later, but that is insurance, not the fix.
 */
import { describe, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

export const URL =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  'https://aogdkqczvlffgydgxsmz.supabase.co'
export const ANON = process.env.VITE_SUPABASE_ANON_KEY
export const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
export const KEYS_MISSING = !ANON || !SERVICE

/**
 * Unique per test process. Vitest gives every test file its own worker, so this
 * isolates suite-from-suite as well as run-from-run. Lowercase base36 + random
 * bytes: legal in an email local part, a slug, an event title and a coupon code
 * alike, so one tag can namespace every fixture type.
 */
export const RUN_TAG = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`

// Prefixes the sweeper matches on. Deliberately narrow: no seeded product slug,
// event title or discount code begins with any of these (verified against the
// live project), so the sweeper can never touch real data.
export const EMAIL_PREFIX = 'vitest+'
export const SLUG_PREFIX = 'vitest-'
export const EVENT_TITLE_PREFIX = 'Vitest Event '
export const CODE_PREFIX = 'VITEST-'

/** A password that satisfies the project's minimum length. Not a secret. */
export const TEST_PASSWORD = 'vitest-fixture-7k2!Local'

export const testEmail = (label) => `${EMAIL_PREFIX}${label}-${RUN_TAG}@example.com`
export const testSlug = (label) => `${SLUG_PREFIX}${label}-${RUN_TAG}`
export const testEventTitle = (name) => `${EVENT_TITLE_PREFIX}${RUN_TAG} — ${name}`
export const testCode = (label) => `${CODE_PREFIX}${label}-${RUN_TAG}`.toUpperCase()

const clientOpts = { auth: { autoRefreshToken: false, persistSession: false } }
export const anonClient = () => createClient(URL, ANON, clientOpts)
export const serviceClient = () => createClient(URL, SERVICE, clientOpts)

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

/**
 * PostgREST/Postgres codes that mean "the thing this probe looked for is not
 * in the schema" — i.e. the migration genuinely has not been pushed yet. Codes
 * confirmed empirically against this project (see the probe transcript in the
 * flakiness investigation): PGRST205 missing table, PGRST202 missing function,
 * PGRST200 missing relationship, 42703 missing column, 42P01/42883 the raw
 * Postgres equivalents when the request reaches the database.
 *
 * Anything NOT in this set — a transport error, a 5xx, an invalid API key — is
 * a BROKEN probe, and must never be reported as "migration not applied".
 */
const MIGRATION_ABSENT_CODES = new Set([
  'PGRST200', 'PGRST202', 'PGRST205', '42703', '42P01', '42883',
])

const isTransient = (err) => {
  if (!err) return false
  const status = err.status ?? err.statusCode
  if (status === 429 || (status >= 500 && status < 600)) return true
  const msg = `${err.message ?? ''} ${err.cause?.message ?? ''}`
  return /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network|timeout|rate limit/i.test(msg)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Run a Supabase call with bounded exponential backoff, retrying ONLY transport
 * failures, 429s and 5xx. A clean application error (RLS denial, constraint
 * violation, missing table) is returned immediately — retrying those would hide
 * exactly the contract failures these suites exist to catch.
 *
 * `fn` is expected to resolve to a Supabase `{ data, error }` result; a thrown
 * transport error is caught and retried too.
 */
export async function withRetry(label, fn, { attempts = 4, baseDelayMs = 400 } = {}) {
  let last
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(baseDelayMs * 2 ** (i - 1))
    try {
      const result = await fn()
      if (!isTransient(result?.error)) return result
      last = result.error
    } catch (thrown) {
      if (!isTransient(thrown)) throw thrown
      last = thrown
    }
  }
  return { data: null, error: last, exhaustedRetries: true, label }
}

/**
 * Turn a Supabase `{ error }` result into a legible throw.
 *
 * `beforeAll` used to assert with `expect(err).toBeNull()`, which reports
 * "expected { code: '23505', ... } to be null" and leaves the reader to work
 * out which of a dozen setup calls blew up. In a deploy gate the hook that
 * failed and why has to be readable at a glance.
 */
export function mustSucceed(label, result) {
  if (result?.error) {
    const e = result.error
    throw new Error(
      `[setup] ${label} failed: ${e.message ?? e}` +
      `${e.code ? ` (code ${e.code})` : ''}${e.details ? ` — ${e.details}` : ''}` +
      `${result.exhaustedRetries ? ' [retries exhausted]' : ''}`,
    )
  }
  return result.data
}

// ---------------------------------------------------------------------------
// Migration gating
// ---------------------------------------------------------------------------

/**
 * Decide whether a migration is live, and — critically — tell "not pushed yet"
 * apart from "the probe itself broke".
 *
 * The old form was `MIGRATED = !error`, which collapsed both cases into a
 * silent skip. A transient network blip during module load therefore made a
 * whole suite report "skipped (migration not applied — run `supabase db push`)"
 * and the run go GREEN having tested nothing. In a deploy gate that is worse
 * than a failure: it is a false all-clear on the exact security contracts
 * (RLS, admin-only RPCs, server-side pricing) the gate exists to protect.
 *
 * Returns `{ applied, broken, reason }`. `broken` must be surfaced as a FAILING
 * test — see `describeGate`.
 */
export async function probeMigration({ migration, label, probe }) {
  if (KEYS_MISSING) {
    return {
      applied: false,
      broken: false,
      reason: 'need VITE_SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY',
    }
  }
  return classifyProbeResult(await withRetry(`probe ${label}`, probe), { migration, label })
}

/**
 * The decision `probeMigration` turns a probe result into. Split out so the
 * three-way outcome can be regression-tested without a live database — see
 * `migrationGate.unit.test.js`. Getting this wrong is what let a broken probe
 * masquerade as a pending migration and pass a deploy gate.
 */
export function classifyProbeResult(result, { migration, label }) {
  if (!result.error) return { applied: true, broken: false, reason: '' }

  if (MIGRATION_ABSENT_CODES.has(result.error.code)) {
    return {
      applied: false,
      broken: false,
      reason: `migration ${migration} not applied — run \`supabase db push\` (probe: ${result.error.message})`,
    }
  }

  return {
    applied: false,
    broken: true,
    reason:
      `the ${label} migration probe could not be answered, so this suite could not ` +
      `establish whether migration ${migration} is live. This is NOT a "migration ` +
      `not pushed" skip — setup broke. Probe error: ${result.error.message}` +
      `${result.error.code ? ` (code ${result.error.code})` : ''}` +
      `${result.exhaustedRetries ? ' [retries exhausted]' : ''}`,
  }
}

/**
 * Register the two diagnostic describe blocks every gated suite needs:
 *
 *   - a BROKEN block that FAILS, so a suite that skipped because setup broke is
 *     visibly different from one that skipped because a migration is pending;
 *   - a skipped-for-a-good-reason block that just states the reason.
 *
 * Call once per gated suite, alongside the real `describe.skipIf(SKIP)`.
 */
export function describeGate(suiteName, gate) {
  describe.skipIf(!gate.broken)(`${suiteName} — SETUP BROKEN`, () => {
    it('fails loudly rather than skipping silently', () => {
      throw new Error(gate.reason)
    })
  })

  describe.skipIf(gate.applied || gate.broken)(`${suiteName} skipped (${gate.reason})`, () => {
    it('reminds devs why this suite did not run', () => {})
  })
}

// ---------------------------------------------------------------------------
// Account provisioning
// ---------------------------------------------------------------------------

/**
 * Create a confirmed, run-tagged customer account and return its id + email.
 *
 * Email confirmation is ON in this project, so accounts are minted with the
 * service-role admin API rather than by clicking a link. The address carries
 * RUN_TAG, so a concurrent run cannot collide with or delete this account —
 * which is the whole point (see the file header).
 *
 * Backs off on 429 via `withRetry`. Measurement says this project does not rate
 * limit at the volume these suites generate, but the backoff costs nothing and
 * covers a busier project later.
 */
export async function createTestUser(admin, label) {
  const email = testEmail(label)
  const result = await withRetry(`createUser ${email}`, () =>
    admin.auth.admin.createUser({ email, password: TEST_PASSWORD, email_confirm: true }),
  )
  const data = mustSucceed(`create test account ${email}`, result)
  return { id: data.user.id, email }
}

/** Sign a client in as a previously-created test account. */
export async function signInAs(client, email) {
  const result = await withRetry(`signIn ${email}`, () =>
    client.auth.signInWithPassword({ email, password: TEST_PASSWORD }),
  )
  mustSucceed(`sign in as ${email}`, result)
}

/** Delete a run's accounts. Safe to call with nulls. */
export async function deleteTestUsers(admin, ...ids) {
  for (const id of ids) {
    if (id) await admin.auth.admin.deleteUser(id).catch(() => {})
  }
}

// ---------------------------------------------------------------------------
// Stale-fixture sweeper (runs once per vitest run, from test/globalSetup.mjs)
// ---------------------------------------------------------------------------

/**
 * A run completes in ~70s. Anything vitest-tagged and older than this is from a
 * crashed or killed run and is safe to delete; anything newer might belong to a
 * run happening right now, so it is left alone.
 */
export const STALE_AFTER_MS = 30 * 60 * 1000

/**
 * Reap fixtures left behind by crashed runs, so the live project does not
 * accumulate test rows. This replaces the per-suite prefix purges that caused
 * the cross-run interference — it is age-bounded, so it cannot touch a live
 * run's data, and it runs once per vitest run instead of six times.
 *
 * Test ORDERS in particular must never be left behind: admin/Dashboard.jsx
 * derives Total Orders, delivered revenue, outstanding total and pending count
 * straight from the orders table, so a stray test order would show up as a real
 * sale in the owner's dashboard.
 *
 * Returns a summary for logging. Never throws — housekeeping must not red a run.
 */
export async function sweepStaleFixtures(admin, { olderThanMs = STALE_AFTER_MS } = {}) {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString()
  const swept = []

  const purge = async (name, build) => {
    try {
      const { error } = await build()
      if (error && !MIGRATION_ABSENT_CODES.has(error.code)) {
        swept.push(`${name}: ${error.message}`)
      }
    } catch (e) {
      swept.push(`${name}: ${e.message}`)
    }
  }

  // Child rows first where a cascade is not guaranteed.
  await purge('event_reservations', () =>
    admin.from('event_reservations').delete().like('email', `${EMAIL_PREFIX}%`).lt('created_at', cutoff))
  await purge('orders', () =>
    admin.from('orders').delete().like('customer_email', `${EMAIL_PREFIX}%`).lt('created_at', cutoff))
  await purge('memberships', () =>
    admin.from('memberships').delete().like('email', `${EMAIL_PREFIX}%`).lt('created_at', cutoff))
  await purge('events', () =>
    admin.from('events').delete().like('title', `${EVENT_TITLE_PREFIX}%`).lt('created_at', cutoff))
  await purge('products', () =>
    admin.from('products').delete().like('slug', `${SLUG_PREFIX}%`).lt('created_at', cutoff))
  await purge('discount_codes', () =>
    admin.from('discount_codes').delete().like('code', `${CODE_PREFIX}%`).lt('created_at', cutoff))
  await purge('newsletter_subscribers', () =>
    admin.from('newsletter_subscribers').delete().like('email', `${EMAIL_PREFIX}%`).lt('subscribed_at', cutoff))

  // Auth users last: admin_users.id cascades from auth.users, so deleting a
  // stale test admin also drops the grant the restock suite made.
  let users = 0
  try {
    const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
    const cutoffMs = Date.now() - olderThanMs
    for (const u of data?.users ?? []) {
      if (!u.email?.startsWith(EMAIL_PREFIX)) continue
      if (new Date(u.created_at).getTime() >= cutoffMs) continue
      await admin.auth.admin.deleteUser(u.id)
      users++
    }
  } catch (e) {
    swept.push(`auth users: ${e.message}`)
  }

  return { cutoff, staleUsersDeleted: users, problems: swept }
}
