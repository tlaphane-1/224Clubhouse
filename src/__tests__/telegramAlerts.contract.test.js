/**
 * Live-DB contract test for 20261008150000_telegram_alerts.
 *
 *   NEGATIVE — anon and customers can't read alert settings or the Telegram
 *              config (which carries the decrypted bot token), and can't
 *              store a token or change the group.
 *   POSITIVE — an admin reads the settings (has_token flag, never the token).
 *
 *   npx vitest run src/__tests__/telegramAlerts.contract.test.js
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  anonClient, serviceClient, probeMigration, describeGate,
  createTestUser, signInAs, deleteTestUsers, mustSucceed,
} from './helpers/liveFixtures.js'

const gate = await probeMigration({
  migration: '20261008150000_telegram_alerts',
  label: 'telegram_config()',
  probe: async () => {
    const res = await serviceClient().rpc('telegram_config')
    return res
  },
})
const SKIP = !gate.applied

const admin = SKIP ? null : serviceClient()
const anon = SKIP ? null : anonClient()
const customer = SKIP ? null : anonClient()
const adminClient = SKIP ? null : anonClient()
let customerUser, adminUser

describe.skipIf(SKIP)('Telegram alerts contract', () => {
  beforeAll(async () => {
    customerUser = await createTestUser(admin, 'tg-customer')
    adminUser = await createTestUser(admin, 'tg-admin')
    mustSucceed('grant admin', await admin.from('admin_users').insert({ id: adminUser.id, email: adminUser.email }))
    await signInAs(customer, customerUser.email)
    await signInAs(adminClient, adminUser.email)
  })

  afterAll(async () => {
    if (admin) await deleteTestUsers(admin, customerUser?.id, adminUser?.id)
  })

  it('NEGATIVE: nobody but the server can read the Telegram config (bot token)', async () => {
    expect((await anon.rpc('telegram_config')).error).not.toBeNull()
    expect((await customer.rpc('telegram_config')).error).not.toBeNull()
    expect((await adminClient.rpc('telegram_config')).error).not.toBeNull()
  })

  it('NEGATIVE: clients cannot store a token or pick the group', async () => {
    expect((await adminClient.rpc('store_telegram_token', { p_token: '1:x' })).error).not.toBeNull()
    expect((await adminClient.rpc('set_telegram_chat', { p_chat_id: 1, p_title: 'x' })).error).not.toBeNull()
  })

  it('NEGATIVE: anon and customers cannot read or change alert settings', async () => {
    expect((await anon.rpc('admin_get_alert_settings')).error).not.toBeNull()
    expect((await customer.rpc('admin_get_alert_settings')).error?.message).toMatch(/not authorized/i)
    expect((await customer.rpc('admin_update_alert_settings', { p_enabled: true, p_kinds: null })).error?.message).toMatch(/not authorized/i)
    const raw = await anon.from('alert_settings').select('*')
    expect(raw.data ?? []).toEqual([])
  })

  it('POSITIVE: an admin reads the settings, without the token itself', async () => {
    const { data, error } = await adminClient.rpc('admin_get_alert_settings')
    expect(error).toBeNull()
    expect(typeof data.has_token).toBe('boolean')
    expect(data).not.toHaveProperty('token')
  })
})

describeGate('Telegram alerts contract', gate)
