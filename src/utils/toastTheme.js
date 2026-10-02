import tailwindConfig from '../../tailwind.config.js'

// Toasts are styled with inline JS objects, so Tailwind classes can't reach
// them. Read the brand tokens from the Tailwind config instead of repeating
// hex values (docs/DESIGN_SYSTEM.md: no raw hex in components).
const { surface, border, gold, background } = tailwindConfig.theme.extend.colors

export const TOAST_OPTIONS = {
  style: { background: surface, color: '#fff', border: `1px solid ${border}` },
  success: { iconTheme: { primary: gold, secondary: background } },
}

// For the few confirmations that deserve a gold edge (newsletter, contact).
export const HIGHLIGHT_TOAST_STYLE = { ...TOAST_OPTIONS.style, border: `1px solid ${gold}` }
