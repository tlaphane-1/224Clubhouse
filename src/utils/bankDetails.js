// Club's FNB business account (supplied by the owner 2026-10-01). Public by
// nature — customers need it to pay. VITE_EFT_BANK_DETAILS overrides it
// (use "\n" for new lines). Keep in step with the EFT_BANK_DETAILS function
// secret used by send-order-email.
const DEFAULT_BANK_DETAILS =
  'Bank: FNB\nAccount holder: 224 Clubhouse\nAccount type: Gold Business Account\nAccount number: 63228491138\nBranch code: 250655'

export const BANK_DETAILS = (import.meta.env.VITE_EFT_BANK_DETAILS || DEFAULT_BANK_DETAILS).replace(/\\n/g, '\n').trim()
