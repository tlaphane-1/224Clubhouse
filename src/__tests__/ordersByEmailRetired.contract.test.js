/**
 * Negative control for 20261007130000_retire_orders_by_email: the email-only
 * order listing must stay gone. If get_orders_by_email ever comes back (a
 * restored dump, a reverted migration), anyone could again list a customer's
 * orders by guessing their address — this test then fails.
 *
 * Skips without the anon key (PR builds without secrets).
 *
 *   npx vitest run src/__tests__/ordersByEmailRetired.contract.test.js
 */
import { describe, it, expect } from 'vitest'
import { anonClient, ANON } from './helpers/liveFixtures.js'

describe.skipIf(!ANON)('Email-only order lookup is retired', () => {
  it('NEGATIVE: get_orders_by_email no longer exists', async () => {
    const { data, error } = await anonClient().rpc('get_orders_by_email', { p_email: 'someone@example.com' })
    expect(data).toBeNull()
    expect(error?.code).toBe('PGRST202')
  })
})
