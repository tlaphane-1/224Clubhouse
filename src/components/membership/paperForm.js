import { tenant } from '../../tenant'
import { MIN_AGE } from '../../utils/age'

// Wording and keys of the club's paper membership form
// ("<store name> Membership Form"). The keys must match place_membership
// (migration 20261005130000_paper_membership_form.sql).

export const CONSUMPTION_REASONS = [
  { key: 'personal_wellness', label: 'Personal wellness' },
  { key: 'recreational', label: 'Recreational purposes' },
  { key: 'medical', label: 'Medical reasons' },
  { key: 'other', label: 'Other' },
]

const consentText = tenant.content.paperForm.consents

export const CONSENTS = [
  // Key stays 'age_21' for every store: place_membership still requires it.
  { key: 'age_21', text: `I confirm that I am ${MIN_AGE} years of age or older.` },
  { key: 'private_club', text: consentText.private_club },
  { key: 'no_redistribution', text: consentText.no_redistribution },
  { key: 'personal_use', text: consentText.personal_use },
  { key: 'code_of_conduct', text: "I understand and accept the Club's code of conduct and privacy policy." },
  { key: 'release_liability', text: consentText.release_liability },
]

export const EMPTY_PAPER_FORM = {
  full_name: '',
  dob_day: '',
  dob_month: '',
  dob_year: '',
  id_number: '',
  phone: '',
  residential_address: '',
  reasons: [],
  reason_other: '',
  consents: Object.fromEntries(CONSENTS.map(c => [c.key, false])),
  signature_image: null,
  signature_typed: '',
  sign_by_typing: false,
}

/** YYYY-MM-DD from the three date boxes, or '' if incomplete/invalid. */
export function paperDob(form) {
  const d = Number(form.dob_day)
  const m = Number(form.dob_month)
  const y = Number(form.dob_year)
  if (!d || !m || String(form.dob_year).length !== 4) return ''
  const date = new Date(y, m - 1, d)
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return ''
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
