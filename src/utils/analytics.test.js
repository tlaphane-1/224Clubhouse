import { describe, it, expect, vi } from 'vitest'

// analytics.js imports the Supabase client, which needs browser env vars;
// these tests only exercise the pure classifiers.
vi.mock('../lib/supabase', () => ({ supabase: {} }))
const { classifySource, classifyDevice } = await import('./analytics')

describe('classifySource', () => {
  const own = '224clubhouse.store'
  it('prefers utm_source', () => {
    expect(classifySource('?utm_source=WhatsApp', 'https://www.google.com/', own)).toBe('whatsapp')
  })
  it('recognises ad click ids', () => {
    expect(classifySource('?fbclid=abc', '', own)).toBe('facebook')
    expect(classifySource('?gclid=abc', '', own)).toBe('google')
  })
  it('maps known referrers', () => {
    expect(classifySource('', 'https://www.google.co.za/', own)).toBe('google')
    expect(classifySource('', 'https://l.instagram.com/', own)).toBe('instagram')
    expect(classifySource('', 'https://wa.me/123', own)).toBe('whatsapp')
    expect(classifySource('', 'https://t.co/x', own)).toBe('twitter')
  })
  it('no referrer or our own site is direct', () => {
    expect(classifySource('', '', own)).toBe('direct')
    expect(classifySource('', 'https://224clubhouse.store/store', own)).toBe('direct')
  })
  it('other sites are recorded by host', () => {
    expect(classifySource('', 'https://www.example.co.za/page', own)).toBe('example.co.za')
  })
})

describe('classifyDevice', () => {
  it('phones', () => {
    expect(classifyDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', 390)).toBe('mobile')
    expect(classifyDevice('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile', 412)).toBe('mobile')
  })
  it('tablets', () => {
    expect(classifyDevice('Mozilla/5.0 (iPad; CPU OS 17_0)', 820)).toBe('tablet')
    expect(classifyDevice('Mozilla/5.0 (Linux; Android 14; SM-X700)', 1200)).toBe('tablet')
  })
  it('desktops', () => {
    expect(classifyDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 1440)).toBe('desktop')
  })
})
