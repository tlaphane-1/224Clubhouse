import { tenant } from '../tenant'

// The store's business bank account (tenant.json bank.details, supplied by the
// owner 2026-10-01). Public by nature — customers need it to pay.
// VITE_EFT_BANK_DETAILS overrides it (use "\n" for new lines). Keep in step
// with the EFT_BANK_DETAILS function secret used by send-order-email.
// A store without a bank account in its config has no EFT: the payment option
// and every "pay by EFT" line are hidden (see EFT_AVAILABLE).
const DEFAULT_BANK_DETAILS = tenant.bank?.details ?? ''

export const BANK_DETAILS = (import.meta.env.VITE_EFT_BANK_DETAILS || DEFAULT_BANK_DETAILS).replace(/\\n/g, '\n').trim()

export const EFT_AVAILABLE = BANK_DETAILS !== ''
