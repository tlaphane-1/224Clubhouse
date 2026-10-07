/**
 * Live-DB contract test for 20261008130000_owner_alerts.
 *
 *   POSITIVE — the service role (the send-daily-summary function) gets the
 *              summary with every field the email reads.
 *   NEGATIVE — anon and a signed-in customer cannot call it: it exposes
 *              customer counts and stock levels.
 *
 *   npx vitest run src/__tests__/ownerAlerts.contract.test.js
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  anonClient, serviceClient, probeMigration, describeGate,
  createTestUser, signInAs, deleteTestUsers, SERVICE,
} from './helpers/liveFixtures.js'

const yesterday = () => new Date(Date.now() - 86400000).toISOString().slice(0, 10)

// Only the service role may call daily_summary_data, so the probe uses it. A
// permission error (42501) would also prove the function exists.
const gate = await probeMigration({
  migration: '20261008130000_owner_alerts',
  label: 'daily_summary_data()',
  probe: async () => {
    if (!SERVICE) return { data: null, error: { message: 'SUPABASE_SERVICE_ROLE_KEY not set' } }
    const res = await serviceClient().rpc('daily_summary_data', { p_day: yesterday() })
    return res.error?.code === '42501' ? { data: true, error: null } : res
  },
})
const SKIP = !gate.applied

const admin = SKIP ? null : serviceClient()
const customer = SKIP ? null : anonClient()
let customerUser

describe.skipIf(SKIP)('Owner alerts contract', () => {
  beforeAll(async () => {
    customerUser = await createTestUser(admin, 'alerts-customer')
    await signInAs(customer, customerUser.email)
  })

  afterAll(async () => {
    if (admin) await deleteTestUsers(admin, customerUser?.id)
  })

  it('POSITIVE: the service role gets the full summary', async () => {
    const { data, error } = await admin.rpc('daily_summary_data', { p_day: yesterday() })
    expect(error).toBeNull()
    for (const key of [
      'day', 'visitors', 'page_views', 'new_accounts', 'orders', 'booked_cents', 'delivered',
      'delivered_cents', 'eft_awaiting', 'eft_proof', 'reviews_pending', 'memberships_pending', 'low_stock',
    ]) {
      expect(data).toHaveProperty(key)
    }
    expect(Array.isArray(data.low_stock)).toBe(true)
  })

  it('NEGATIVE: anon cannot call it', async () => {
    const { data, error } = await anonClient().rpc('daily_summary_data', { p_day: yesterday() })
    expect(data).toBeNull()
    expect(error).not.toBeNull()
  })

  it('NEGATIVE: a signed-in customer cannot call it', async () => {
    const { data, error } = await customer.rpc('daily_summary_data', { p_day: yesterday() })
    expect(data).toBeNull()
    expect(error).not.toBeNull()
  })
})

describeGate('Owner alerts contract', gate)
