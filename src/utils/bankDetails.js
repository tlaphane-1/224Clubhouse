import { tenant } from '../tenant'

// The store's business bank account (tenant.json bank.details, supplied by the
// owner 2026-10-01). Public by nature — customers need it to pay.
// VITE_EFT_BANK_DETAILS overrides it (use "\n" for new lines). Keep in step
// with the EFT_BANK_DETAILS function secret used by send-order-email.
const DEFAULT_BANK_DETAILS = tenant.bank.details

export const BANK_DETAILS = (import.meta.env.VITE_EFT_BANK_DETAILS || DEFAULT_BANK_DETAILS).replace(/\\n/g, '\n').trim()
