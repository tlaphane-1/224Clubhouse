import { describe, it, expect } from 'vitest'
import { selfiePath, shiftDuration, dayBoundsSast } from './shifts'

describe('selfiePath', () => {
  it('puts the selfie in <tenant>/<uid>/<time>.<ext>', () => {
    expect(selfiePath('explosive420', 'u1', 1700000000000, 'image/png')).toBe('explosive420/u1/1700000000000.png')
    expect(selfiePath('explosive420', 'u1', 1, 'image/webp')).toBe('explosive420/u1/1.webp')
    expect(selfiePath('explosive420', 'u1', 1, 'image/heic')).toBe('explosive420/u1/1.heic')
    expect(selfiePath('explosive420', 'u1', 1, 'image/heif')).toBe('explosive420/u1/1.heic')
  })

  it('anything else is saved as jpg', () => {
    expect(selfiePath('explosive420', 'u1', 1, 'image/jpeg')).toBe('explosive420/u1/1.jpg')
    expect(selfiePath('explosive420', 'u1', 1, '')).toBe('explosive420/u1/1.jpg')
  })
})

describe('shiftDuration', () => {
  it('formats hours and zero-padded minutes', () => {
    expect(shiftDuration('2026-11-25T07:00:00Z', '2026-11-25T14:05:00Z')).toBe('7h 05m')
    expect(shiftDuration('2026-11-25T07:00:00Z', '2026-11-25T07:45:00Z')).toBe('0h 45m')
  })

  it('an open shift runs until now', () => {
    expect(shiftDuration('2026-11-25T07:00:00Z', null, Date.parse('2026-11-25T09:14:00Z'))).toBe('2h 14m')
  })
})

describe('dayBoundsSast', () => {
  it('is midnight to midnight in South Africa (UTC+2)', () => {
    expect(dayBoundsSast('2026-11-25')).toEqual({
      from: '2026-11-24T22:00:00.000Z',
      to: '2026-11-25T22:00:00.000Z',
    })
  })
})
