import { formatZAR } from './formatCurrency'

// Membership prices are whole rands today — show the compact "R10" look, but
// fall back to full formatting if an admin ever sets e.g. 1050 cents.
export function formatTierPrice(cents) {
  return cents % 100 === 0 ? `R${cents / 100}` : formatZAR(cents)
}
