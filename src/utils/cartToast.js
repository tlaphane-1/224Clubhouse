import toast from 'react-hot-toast'

import { TOAST_OPTIONS } from './toastTheme'

// The nudge is two lines, so keep the newline.
const STYLE = { ...TOAST_OPTIONS.style, whiteSpace: 'pre-line' }

// Non-members get a nudge with every add — free delivery is the membership
// perk most likely to convert a shopper (2026-10-01 testing feedback).
export function toastAddedToCart(productName, isMember) {
  const nudge = isMember ? '' : '\nBecome a member for FREE delivery.'
  toast.success(`${productName} added to cart${nudge}`, {
    style: STYLE,
    duration: isMember ? 2000 : 4000,
  })
}
