import { loadTenant } from './tenants/loadTenant.mjs'

// Brand palette and fonts come from the active store's tenant.json
// (tenants/<TENANT>/). Glow shadows below are derived from the palette so they
// can't drift.
const { colors, fonts } = loadTenant().theme

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
        heading: fonts.heading,
        body: fonts.body,
        // Handwriting for answers on the paper membership form.
        hand: fonts.hand,
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
