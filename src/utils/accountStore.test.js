import { describe, it, expect } from 'vitest'
import { accountBelongsHere, wrongStoreError, WRONG_STORE } from './accountStore'

describe('accountBelongsHere', () => {
  it('accepts an account stamped for this store', () => {
    expect(accountBelongsHere({ app_metadata: { tenant: 'explosive420' } }, 'explosive420')).toBe(true)
  })

  it('refuses an account stamped for another store', () => {
    expect(accountBelongsHere({ app_metadata: { tenant: '224clubhouse' } }, 'explosive420')).toBe(false)
    expect(accountBelongsHere({ app_metadata: { tenant: 'explosive420' } }, '224clubhouse')).toBe(false)
  })

  it('accepts an unstamped account rather than locking it out', () => {
    expect(accountBelongsHere({ app_metadata: {} }, 'explosive420')).toBe(true)
    expect(accountBelongsHere({}, 'explosive420')).toBe(true)
  })

  it('ignores user_metadata.tenant, which the user can edit', () => {
    const user = { app_metadata: { tenant: '224clubhouse' }, user_metadata: { tenant: 'explosive420' } }
    expect(accountBelongsHere(user, 'explosive420')).toBe(false)
  })
})

describe('wrongStoreError', () => {
  it('names this store, not the other one, and carries a code callers can test', () => {
    const err = wrongStoreError('Explosive 420 Cannabis Social Club')
    expect(err.code).toBe(WRONG_STORE)
    expect(err.message).toMatch(/registered with another club/)
    expect(err.message).toMatch(/Explosive 420 Cannabis Social Club/)
    expect(err.message).not.toMatch(/224/)
  })
})
