import { describe, it, expect } from 'vitest'
import { selfiePath, shiftDuration, dayBoundsSast, shiftStatusLabel, formatSastTime, sortShifts, fitWithin, shiftsDayFilter } from './shifts'

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

describe('formatSastTime', () => {
  it('shows the time in South Africa', () => {
    expect(formatSastTime('2026-11-25T07:02:00Z')).toBe('09:02')
    expect(formatSastTime('2026-11-25T22:30:00Z')).toBe('00:30')
  })
})

describe('shiftStatusLabel', () => {
  it('not on shift', () => {
    expect(shiftStatusLabel(null, 0)).toBe('Not on shift')
  })

  it('on shift since the start time, with how long so far', () => {
    expect(shiftStatusLabel({ started_at: '2026-11-25T07:02:00Z' }, Date.parse('2026-11-25T09:16:00Z')))
      .toBe('On shift since 09:02 · 2h 14m')
  })
})

describe('sortShifts', () => {
  it('open shifts first, then the newest start first', () => {
    const rows = [
      { id: 'a', started_at: '2026-11-25T06:00:00Z', ended_at: '2026-11-25T08:00:00Z' },
      { id: 'b', started_at: '2026-11-25T07:00:00Z', ended_at: null },
      { id: 'c', started_at: '2026-11-25T09:00:00Z', ended_at: '2026-11-25T10:00:00Z' },
    ]
    expect(sortShifts(rows).map(r => r.id)).toEqual(['b', 'c', 'a'])
  })
})

describe('fitWithin', () => {
  it('shrinks the long side to the limit, keeping the shape', () => {
    expect(fitWithin(4032, 3024, 1280)).toEqual({ width: 1280, height: 960 })
    expect(fitWithin(3024, 4032, 1280)).toEqual({ width: 960, height: 1280 })
  })

  it('leaves a small photo alone', () => {
    expect(fitWithin(800, 600, 1280)).toEqual({ width: 800, height: 600 })
  })
})

describe('shiftsDayFilter', () => {
  it('shifts that started that day, plus any still open from before', () => {
    expect(shiftsDayFilter('A', 'B')).toBe('and(started_at.gte.A,started_at.lt.B),and(ended_at.is.null,started_at.lt.B)')
  })
})
