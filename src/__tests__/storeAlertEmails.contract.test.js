/**
 * Live-DB contract test for 20261107120000_store_alert_emails.
 *
 *   POSITIVE — the server (service role) reads each store's alert_emails, and
 *              224's is unset, so 224's alerts keep using the ADMIN_ALERT_EMAIL
 *              secret (supabase/functions/_shared/storeAlerts.ts).
 *   NEGATIVE — anon, customers and admins cannot read the column directly:
 *              alert_settings stays RLS-on with no policies.
 *
 *   npx vitest run src/__tests__/storeAlertEmails.contract.test.js
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  anonClient, serviceClient, probeMigration, describeGate,
  createTestUser, signInAs, deleteTestUsers, mustSucceed,
} from './helpers/liveFixtures.js'

const gate = await probeMigration({
  migration: '20261107120000_store_alert_emails',
  label: 'alert_settings.alert_emails',
  probe: async () => serviceClient().from('alert_settings').select('alert_emails').limit(1),
})
const SKIP = !gate.applied

const admin = SKIP ? null : serviceClient()
const anon = SKIP ? null : anonClient()
const customer = SKIP ? null : anonClient()
const adminClient = SKIP ? null : anonClient()
let customerUser, adminUser

describe.skipIf(SKIP)('Store alert emails contract', () => {
  beforeAll(async () => {
    customerUser = await createTestUser(admin, 'alerts-customer')
    adminUser = await createTestUser(admin, 'alerts-admin')
    mustSucceed('grant admin', await admin.from('admin_users').insert({ id: adminUser.id, email: adminUser.email }))
    await signInAs(customer, customerUser.email)
    await signInAs(adminClient, adminUser.email)
  })

  afterAll(async () => {
    if (admin) await deleteTestUsers(admin, customerUser?.id, adminUser?.id)
  })

  it('POSITIVE: the server reads alert_emails; 224 has none, so it keeps the ADMIN_ALERT_EMAIL fallback', async () => {
    const row = mustSucceed('224 alert settings', await admin.from('alert_settings')
      .select('tenant, alert_emails').eq('tenant', '224clubhouse').single())
    expect(row.alert_emails).toBeNull()
  })

  it('NEGATIVE: nobody but the server can read alert_emails', async () => {
    for (const client of [anon, customer, adminClient]) {
      const raw = await client.from('alert_settings').select('tenant, alert_emails')
      expect(raw.data ?? []).toEqual([])
    }
  })
})

describeGate('Store alert emails contract', gate)
