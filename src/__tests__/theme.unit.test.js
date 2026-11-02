import { describe, it, expect } from 'vitest'

describe('tailwind theme from tenant', () => {
  it('takes colours and fonts from the 224 tenant unchanged', async () => {
    const { default: config } = await import('../../tailwind.config.js')
    const { colors, fontFamily } = config.theme.extend
    expect(colors).toEqual({
      background: '#0a0a0a',
      surface: '#111111',
      gold: '#C9A84C',
      'gold-light': '#e2c074',
      muted: '#888888',
      border: '#222222',
      leaf: '#7CC242',
      'leaf-deep': '#1B2E12',
      paper: '#FBF8F1',
      'paper-line': '#CFC8B8',
      print: '#1C1C1C',
      ink: '#1D3D8F',
    })
    expect(fontFamily.heading).toEqual(['"Playfair Display"', 'serif'])
    expect(fontFamily.body).toEqual(['Inter', 'sans-serif'])
    expect(fontFamily.hand).toEqual(['Caveat', 'cursive'])
  })
})
