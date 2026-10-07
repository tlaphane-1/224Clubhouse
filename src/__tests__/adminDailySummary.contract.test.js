/**
 * Live-DB contract test for 20261008160000_admin_daily_summary (the
 * Dashboard's "Share today's summary" on WhatsApp).
 *
 *   NEGATIVE — anon and customers cannot read the summary.
 *   POSITIVE — an admin gets today's numbers.
 *
 *   npx vitest run src/__tests__/adminDailySummary.contract.test.js
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  anonClient, serviceClient, probeMigration, describeGate,
  createTestUser, signInAs, deleteTestUsers, mustSucceed,
} from './helpers/liveFixtures.js'

const gate = await probeMigration({
  migration: '20261008160000_admin_daily_summary',
  label: 'admin_daily_summary()',
  // Anon gets "Not authorized" (P0001) once the function exists — that's "applied".
  probe: async () => {
    const res = await anonClient().rpc('admin_daily_summary', { p_day: null })
    return res.error?.code === 'P0001' ? { data: null, error: null } : res
  },
})
const SKIP = !gate.applied

const admin = SKIP ? null : serviceClient()
const customer = SKIP ? null : anonClient()
const adminClient = SKIP ? null : anonClient()
let customerUser, adminUser

describe.skipIf(SKIP)('Admin daily summary contract', () => {
  beforeAll(async () => {
    customerUser = await createTestUser(admin, 'sum-customer')
    adminUser = await createTestUser(admin, 'sum-admin')
    mustSucceed('grant admin', await admin.from('admin_users').insert({ id: adminUser.id, email: adminUser.email }))
    await signInAs(customer, customerUser.email)
    await signInAs(adminClient, adminUser.email)
  })

  afterAll(async () => {
    if (admin) await deleteTestUsers(admin, customerUser?.id, adminUser?.id)
  })

  it('NEGATIVE: a customer cannot read the summary', async () => {
    const { error } = await customer.rpc('admin_daily_summary', { p_day: null })
    expect(error?.message).toMatch(/not authorized/i)
  })

  it('POSITIVE: an admin gets today\'s numbers', async () => {
    const { data, error } = await adminClient.rpc('admin_daily_summary', { p_day: null })
    expect(error).toBeNull()
    for (const k of ['day', 'visitors', 'orders', 'booked_cents', 'eft_awaiting', 'eft_proof', 'low_stock']) {
      expect(data).toHaveProperty(k)
    }
  })
})

describeGate('Admin daily summary contract', gate)
