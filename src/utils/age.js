// Minimum-age helpers for the date-of-birth fields. The server
// (set_date_of_birth, place_cod_order — tenant_min_age()) is the real check;
// these only give the customer a friendly answer before the round trip.
import { tenant } from '../tenant'

// Per store (tenant.json minimumAge; 21 for 224). Must match the store's
// tenants.min_age row, which is what the server enforces.
export const MIN_AGE = tenant.minimumAge

const pad = (n) => String(n).padStart(2, '0')
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** Latest date of birth that is MIN_AGE today, as YYYY-MM-DD (the input's max). */
export function latestAdultDob(today = new Date()) {
  const d = new Date(today.getFullYear() - MIN_AGE, today.getMonth(), today.getDate())
  // 29 Feb birthdays: Date rolls 29 Feb into 1 Mar in non-leap years, which
  // is also when such a person legally comes of age there.
  return iso(d)
}

/** True when `dob` (YYYY-MM-DD) is a real date making the person MIN_AGE+ today. */
export function isAdultDob(dob, today = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob ?? '')) return false
  if (dob < '1900-01-01') return false
  return dob <= latestAdultDob(today)
}
