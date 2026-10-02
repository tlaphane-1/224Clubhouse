export function formatZAR(amountInCents) {
  const n = Number(amountInCents)
  const safe = Number.isFinite(n) ? n : 0 // guard null/undefined/NaN -> "R0.00" not "R NaN"
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 2,
  }).format(safe / 100)
}
