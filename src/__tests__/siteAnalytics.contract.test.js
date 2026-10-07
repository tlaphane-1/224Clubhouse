/**
 * Live-DB contract test for 20261007140000_site_analytics.
 *
 *   POSITIVE — anyone (anon) can record an event via track_event.
 *   NEGATIVE — admin paths are dropped even if a client sends them.
 *   NEGATIVE — anon and customers cannot read raw events or the summary.
 *   POSITIVE — an admin gets the summary, including the event just recorded.
 *
 *   npx vitest run src/__tests__/siteAnalytics.contract.test.js
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  anonClient, serviceClient, probeMigration, describeGate,
  createTestUser, signInAs, deleteTestUsers, mustSucceed,
} from './helpers/liveFixtures.js'

const gate = await probeMigration({
  migration: '20261007140000_site_analytics',
  label: 'track_event()',
  // A null visitor is a valid no-op call: proves the function exists, writes nothing.
  probe: () => anonClient().rpc('track_event', {
    p_visitor: null, p_session: null, p_event: 'page_view', p_path: '/',
  }),
})
const SKIP = !gate.applied

const admin = SKIP ? null : serviceClient()
const anon = SKIP ? null : anonClient()
const customer = SKIP ? null : anonClient()
const adminClient = SKIP ? null : anonClient()
const VISITOR = randomUUID()
const SESSION = randomUUID()
let customerUser, adminUser

describe.skipIf(SKIP)('Site analytics contract', () => {
  beforeAll(async () => {
    customerUser = await createTestUser(admin, 'analytics-customer')
    adminUser = await createTestUser(admin, 'analytics-admin')
    mustSucceed('grant admin', await admin.from('admin_users').insert({ id: adminUser.id, email: adminUser.email }))
    await signInAs(customer, customerUser.email)
    await signInAs(adminClient, adminUser.email)
  })

  afterAll(async () => {
    if (!admin) return
    await admin.from('site_events').delete().eq('visitor_id', VISITOR)
    await deleteTestUsers(admin, customerUser?.id, adminUser?.id)
  })

  it('POSITIVE: anon records a page view', async () => {
    const { error } = await anon.rpc('track_event', {
      p_visitor: VISITOR, p_session: SESSION, p_event: 'page_view',
      p_path: '/store', p_source: 'whatsapp', p_device: 'mobile',
    })
    expect(error).toBeNull()
    const { data } = await admin.from('site_events').select('path, source, device').eq('visitor_id', VISITOR)
    expect(data).toEqual([{ path: '/store', source: 'whatsapp', device: 'mobile' }])
  })

  it('NEGATIVE: admin paths and unknown events are dropped', async () => {
    await anon.rpc('track_event', { p_visitor: VISITOR, p_session: SESSION, p_event: 'page_view', p_path: '/admin/orders' })
    await anon.rpc('track_event', { p_visitor: VISITOR, p_session: SESSION, p_event: 'hack', p_path: '/' })
    const { count } = await admin.from('site_events').select('*', { count: 'exact', head: true }).eq('visitor_id', VISITOR)
    expect(count).toBe(1)
  })

  it('NEGATIVE: anon and customers cannot read events or the summary', async () => {
    const raw = await anon.from('site_events').select('*').limit(1)
    expect(raw.data ?? []).toEqual([])
    const a = await anon.rpc('site_analytics', { p_days: 7 })
    expect(a.error).not.toBeNull()
    const c = await customer.rpc('site_analytics', { p_days: 7 })
    expect(c.error?.message).toMatch(/not authorized/i)
  })

  it('POSITIVE: an admin gets the summary', async () => {
    const { data, error } = await adminClient.rpc('site_analytics', { p_days: 1 })
    expect(error).toBeNull()
    expect(data.visitors).toBeGreaterThanOrEqual(1)
    expect(data.daily).toHaveLength(1)
    expect(data.funnel.visited).toBeGreaterThanOrEqual(1)
    expect(Array.isArray(data.sources)).toBe(true)
  })
})

describeGate('Site analytics contract', gate)
