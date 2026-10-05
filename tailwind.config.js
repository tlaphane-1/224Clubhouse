// Brand palette. Glow shadows below are derived from it so they can't drift.
const colors = {
  background: '#0a0a0a',
  surface: '#111111',
  gold: '#C9A84C',
  'gold-light': '#e2c074',
  muted: '#888888',
  border: '#222222',
  // Botanical accent, taken from the club letterhead. Accent only
  // (chips, glows, delivery/member highlights) — gold stays the CTA colour.
  leaf: '#7CC242',
  'leaf-deep': '#1B2E12',
  // The paper membership form only: off-white sheet, printed black text,
  // ruled lines, and blue pen ink for what the applicant "writes".
  paper: '#FBF8F1',
  'paper-line': '#CFC8B8',
  print: '#1C1C1C',
  ink: '#1D3D8F',
}

const rgba = (hex, alpha) => {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  // Most visitors browse on phones. Without this, tapping a card leaves its
  // hover glow "stuck" on until the next tap elsewhere. Touch feedback comes
  // from active: states instead.
  future: {
    hoverOnlyWhenSupported: true,
  },
  theme: {
    extend: {
      colors,
      fontFamily: {
        heading: ['"Playfair Display"', 'serif'],
        body: ['Inter', 'sans-serif'],
        // Handwriting for answers on the paper membership form.
        hand: ['Caveat', 'cursive'],
      },
      aspectRatio: {
        // Product photos: taller than square so two fit side by side on a phone
        // and still read as large images.
        portrait: '4 / 5',
      },
      boxShadow: {
        glow: `0 0 28px -6px ${rgba(colors.gold, 0.55)}`,
        'glow-leaf': `0 0 24px -4px ${rgba(colors.leaf, 0.5)}`,
      },
    },
  },
  plugins: [],
}
