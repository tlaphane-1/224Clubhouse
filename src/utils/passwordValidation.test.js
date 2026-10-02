import { describe, expect, it } from 'vitest'
import { MIN_PASSWORD_LENGTH, validateNewPassword } from './passwordValidation'

// Pure validation shared by signup (CustomerAuth) and the reset-password page.
// Runs in vitest's node environment — no DOM, no Supabase.

describe('validateNewPassword', () => {
  it('accepts a matching pair at the minimum length', () => {
    expect(validateNewPassword('abc123', 'abc123')).toBeNull()
  })

  it('accepts a longer matching pair', () => {
    expect(validateNewPassword('correct horse battery', 'correct horse battery')).toBeNull()
  })

  it('rejects a password shorter than the minimum', () => {
    expect(validateNewPassword('abc12', 'abc12')).toBe(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    )
  })

  it('rejects an empty password', () => {
    expect(validateNewPassword('', '')).toBe(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    )
  })

  it('rejects null/undefined without throwing (length check first)', () => {
    expect(validateNewPassword(null, null)).toBe(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    )
    expect(validateNewPassword(undefined, undefined)).toBe(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    )
  })

  it('rejects a mismatched confirmation', () => {
    expect(validateNewPassword('abc123', 'abc124')).toBe('Passwords do not match')
  })

  it('checks length before match, so a short mismatched pair reports length first', () => {
    expect(validateNewPassword('abc', 'xyz')).toBe(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    )
  })

  it('is case-sensitive on the match', () => {
    expect(validateNewPassword('Abc123', 'abc123')).toBe('Passwords do not match')
  })
})
