import { describe, it, expect } from 'vitest'
import { memberNumber, cardStatus, cardName } from './memberCard'

describe('memberNumber', () => {
  it('is short, readable and stable for an account', () => {
    const n = memberNumber('E420', '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d')
    expect(n).toMatch(/^E420-M-[0-9A-Z]{6}$/)
    expect(memberNumber('E420', '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d')).toBe(n)
  })
  it('differs between accounts and avoids look-alike characters', () => {
    const a = memberNumber('E420', '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d')
    const b = memberNumber('E420', '00000000-0000-4000-8000-000000000001')
    expect(a).not.toBe(b)
    expect(a.slice(7)).not.toMatch(/[01IO]/)
    expect(b.slice(7)).not.toMatch(/[01IO]/)
  })
})

describe('cardStatus', () => {
  it('labels each membership state', () => {
    expect(cardStatus('active')).toEqual({ label: 'Active', tone: 'active' })
    expect(cardStatus('pending')).toEqual({ label: 'Pending approval', tone: 'pending' })
    expect(cardStatus('expired')).toEqual({ label: 'Expired', tone: 'expired' })
    expect(cardStatus(null)).toEqual({ label: 'Not a member yet', tone: 'none' })
  })
})

describe('cardName', () => {
  it('prefers the membership name, then the account name, then the email', () => {
    expect(cardName({ full_name: 'Thabo Mokoena' }, { email: 'x@y.z' })).toBe('Thabo Mokoena')
    expect(cardName(null, { email: 'thabo@example.com', user_metadata: { full_name: 'Thabo M' } })).toBe('Thabo M')
    expect(cardName(null, { email: 'thabo@example.com' })).toBe('thabo')
  })
})
