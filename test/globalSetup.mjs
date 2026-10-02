/**
 * Vitest globalSetup: reap live-DB fixtures left behind by crashed runs.
 *
 * This replaces the per-suite "delete everything matching my fixed fixture
 * names" purges that each contract suite used to run in `beforeAll`. Those
 * purges were the source of the suite's flakiness: with a second vitest process
 * alive (a colleague, CI, or an orphaned worker from an interrupted run) each
 * run deleted the other's live fixtures mid-test. See the header of
 * `src/__tests__/helpers/liveFixtures.js` for the full diagnosis.
 *
 * Runs ONCE per vitest run, before any test file, and only deletes rows older
 * than STALE_AFTER_MS — so it can never race a run that is happening right now.
 *
 * Housekeeping failures are logged, not thrown: a network blip while sweeping
 * leftovers must not red a deploy gate. Anything that genuinely matters is
 * asserted inside the suites.
 */
import './loadEnv.mjs'
import { createClient } from '@supabase/supabase-js'

export default async function setup() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !service) return // contract suites auto-skip without keys anyway

  const { sweepStaleFixtures } = await import('../src/__tests__/helpers/liveFixtures.js')
  const admin = createClient(url, service, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  try {
    const { staleUsersDeleted, problems } = await sweepStaleFixtures(admin)
    if (staleUsersDeleted) {
      console.log(`[globalSetup] reaped ${staleUsersDeleted} stale vitest auth account(s)`)
    }
    if (problems.length) {
      console.warn(`[globalSetup] fixture sweep had problems: ${problems.join('; ')}`)
    }
  } catch (e) {
    console.warn(`[globalSetup] fixture sweep skipped: ${e.message}`)
  }
}
