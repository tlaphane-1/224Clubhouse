// Digital membership card helpers (My Account). The card's QR is the club
// card token; these only shape what the card shows.

// No 0/1/I/O, so staff can read the number out without mix-ups.
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

/** A short member number that stays the same for an account, e.g. "E420-M-7Q4KXA". */
export function memberNumber(prefix, userId) {
  const hex = String(userId ?? '').replace(/-/g, '')
  // 30 bits from the start of the account id → 6 characters of 5 bits each.
  let n = parseInt(hex.slice(0, 8) || '0', 16) >>> 2
  let out = ''
  for (let i = 0; i < 6; i++) {
    out = ALPHABET[n & 31] + out
    n >>>= 5
  }
  return `${prefix}-M-${out}`
}

const STATUSES = {
  active: { label: 'Active', tone: 'active' },
  pending: { label: 'Pending approval', tone: 'pending' },
  expired: { label: 'Expired', tone: 'expired' },
}

/** The badge on the card, from the membership's live status. */
export function cardStatus(effectiveStatus) {
  return STATUSES[effectiveStatus] ?? { label: 'Not a member yet', tone: 'none' }
}

/** The name printed on the card. */
export function cardName(membership, user) {
  return membership?.full_name?.trim()
    || user?.user_metadata?.full_name?.trim()
    || String(user?.email ?? '').split('@')[0]
}
