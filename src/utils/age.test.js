import { describe, it, expect } from 'vitest'
import { latestAdultDob, isAdultDob } from './age'

const today = new Date(2026, 9, 8) // 8 Oct 2026

describe('age helpers', () => {
  it('latest adult DOB is exactly 21 years ago', () => {
    expect(latestAdultDob(today)).toBe('2005-10-08')
  })
  it('21st birthday today counts as adult; tomorrow does not', () => {
    expect(isAdultDob('2005-10-08', today)).toBe(true)
    expect(isAdultDob('2005-10-09', today)).toBe(false)
  })
  it('rejects junk and absurd dates', () => {
    expect(isAdultDob('', today)).toBe(false)
    expect(isAdultDob('08/10/1990', today)).toBe(false)
    expect(isAdultDob('1899-12-31', today)).toBe(false)
    expect(isAdultDob('1990-01-01', today)).toBe(true)
  })
})
