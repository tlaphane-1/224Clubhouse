/**
 * Regression test for the deploy gate's skip semantics. No database needed.
 *
 * Every live contract suite is gated on a module-load probe that asks "is this
 * migration applied?". The original form was:
 *
 *     MIGRATED = !error                     // or: !err && data === true
 *
 * which answers "no" to two very different questions. A migration that has not
 * been pushed yet is a legitimate skip. A probe that could not be answered —
 * a dropped connection, a 5xx, a bad API key — is BROKEN SETUP, and collapsing
 * it into the same silent skip made the whole suite report
 * "skipped (migration not applied — run `supabase db push`)" while the run went
 * GREEN having asserted nothing. In `predeploy` that is a false all-clear on
 * the RLS policies, admin-only RPCs and server-side pricing the gate exists to
 * protect — strictly worse than a red build.
 *
 * These cases pin the three-way outcome so that distinction cannot regress.
 */
import { describe, it, expect } from 'vitest'
import { classifyProbeResult, withRetry } from './helpers/liveFixtures.js'

const ctx = { migration: '20260814103000_discount_codes', label: 'discount_codes' }
const classify = (error, extra = {}) => classifyProbeResult({ error, ...extra }, ctx)

describe('migration gate — a clean probe means the suite runs', () => {
  it('no error at all: applied, not broken', () => {
    const gate = classify(null)
    expect(gate).toEqual({ applied: true, broken: false, reason: '' })
  })
})

describe('migration gate — schema absence is a legitimate skip', () => {
  // Codes confirmed against the live project: PostgREST answers with these
  // when the table/function/column/relationship is genuinely not in the schema.
  const absent = [
    ['PGRST205', "Could not find the table 'public.discount_codes' in the schema cache"],
    ['PGRST202', 'Could not find the function public.order_cancel_restocks in the schema cache'],
    ['PGRST200', "Could not find a relationship between 'products' and 'x'"],
    ['42703', 'column products.capacity does not exist'],
    ['42P01', 'relation "discount_codes" does not exist'],
    ['42883', 'function order_cancel_restocks() does not exist'],
  ]

  it.each(absent)('%s is "not applied", not "broken"', (code, message) => {
    const gate = classify({ code, message })
    expect(gate.applied).toBe(false)
    expect(gate.broken).toBe(false)
    expect(gate.reason).toContain('not applied')
    expect(gate.reason).toContain(ctx.migration)
    // The reason has to be actionable — it is the only thing a dev sees.
    expect(gate.reason).toContain('supabase db push')
  })
})

describe('migration gate — an unanswerable probe must be LOUD, never a silent skip', () => {
  // The realistic ways a probe fails without saying anything about the schema.
  const broken = [
    [{ message: 'Invalid API key' }, 'no code at all (auth rejected before Postgres)'],
    [{ message: 'fetch failed' }, 'transport failure'],
    [{ code: '503', message: 'Service Unavailable' }, 'upstream 5xx'],
    [{ code: '57014', message: 'canceling statement due to statement timeout' }, 'statement timeout'],
    [{ code: '42501', message: 'permission denied for table discount_codes' }, 'permission denied'],
  ]

  it.each(broken)('%o is broken (%s)', (error) => {
    const gate = classify(error)
    expect(gate.broken).toBe(true)
    expect(gate.applied).toBe(false)
  })

  it('says plainly that this is NOT a pending-migration skip', () => {
    const gate = classify({ message: 'fetch failed' })
    expect(gate.reason).toContain('setup broke')
    expect(gate.reason).toContain('NOT a "migration')
    // The underlying error has to survive into the message, or the failure is
    // as uninformative as the silent skip it replaced.
    expect(gate.reason).toContain('fetch failed')
  })

  it('flags when the retries were used up, so a flaky network is distinguishable', () => {
    const gate = classify({ message: 'ECONNRESET' }, { exhaustedRetries: true })
    expect(gate.reason).toContain('retries exhausted')
  })

  // A permission error is the subtle one: RLS denying the probe is a real
  // problem to investigate, and must never read as "just push the migration".
  it('permission denied is never reported as a pending migration', () => {
    const gate = classify({ code: '42501', message: 'permission denied for table discount_codes' })
    expect(gate.reason).not.toContain('supabase db push')
  })
})

describe('withRetry — retries transport blips, never contract failures', () => {
  it('retries a transient error and returns the eventual success', async () => {
    let calls = 0
    const result = await withRetry('flaky', async () => {
      calls++
      return calls < 3 ? { data: null, error: { message: 'fetch failed' } } : { data: 'ok', error: null }
    }, { baseDelayMs: 1 })
    expect(calls).toBe(3)
    expect(result.data).toBe('ok')
  })

  it('does NOT retry an application error — an RLS denial is the answer, not a blip', async () => {
    let calls = 0
    const result = await withRetry('denied', async () => {
      calls++
      return { data: null, error: { code: '42501', message: 'permission denied' } }
    }, { baseDelayMs: 1 })
    // Retrying contract failures is how a real regression gets hidden behind a
    // "it passed on attempt 4" green.
    expect(calls).toBe(1)
    expect(result.error.code).toBe('42501')
  })

  it('gives up after a bounded number of attempts and says so', async () => {
    let calls = 0
    const result = await withRetry('down', async () => {
      calls++
      return { data: null, error: { message: 'ECONNRESET' } }
    }, { attempts: 3, baseDelayMs: 1 })
    expect(calls).toBe(3)
    expect(result.exhaustedRetries).toBe(true)
  })

  it('treats 429 as transient, so a rate-limited project backs off instead of failing', async () => {
    let calls = 0
    await withRetry('limited', async () => {
      calls++
      return calls < 2
        ? { data: null, error: { status: 429, message: 'Too Many Requests' } }
        : { data: 'ok', error: null }
    }, { baseDelayMs: 1 })
    expect(calls).toBe(2)
  })
})
