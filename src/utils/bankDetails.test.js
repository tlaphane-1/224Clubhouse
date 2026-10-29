import { describe, it, expect, vi, afterEach } from 'vitest'
import { tenant } from '../tenant.js'

// BANK_DETAILS is computed at import time, so each case needs a fresh module
// after the env stub is in place.
async function freshBankDetails() {
  vi.resetModules()
  return (await import('./bankDetails.js')).BANK_DETAILS
}

describe('BANK_DETAILS', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('VITE_EFT_BANK_DETAILS overrides the default, expanding \n to newlines', async () => {
    // Literal backslash + n, exactly as it sits in a .env file.
    vi.stubEnv('VITE_EFT_BANK_DETAILS', 'Bank: X\\nAcc: 1')
    expect(await freshBankDetails()).toBe('Bank: X\nAcc: 1')
  })

  it('falls back to the tenant bank details when the override is unset', async () => {
    vi.stubEnv('VITE_EFT_BANK_DETAILS', '')
    expect(await freshBankDetails()).toBe(tenant.bank.details.trim())
  })
})
