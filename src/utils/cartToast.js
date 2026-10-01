import toast from 'react-hot-toast'

const STYLE = {
  background: '#111111', color: '#fff', border: '1px solid #222222', whiteSpace: 'pre-line',
}

// Non-members get a nudge with every add — free delivery is the membership
// perk most likely to convert a shopper (2026-10-01 testing feedback).
export function toastAddedToCart(productName, isMember) {
  const nudge = isMember ? '' : '\nBecome a member for FREE delivery.'
  toast.success(`${productName} added to cart${nudge}`, {
    style: STYLE,
    iconTheme: { primary: '#C9A84C', secondary: '#000' },
    duration: isMember ? 2000 : 4000,
  })
}
