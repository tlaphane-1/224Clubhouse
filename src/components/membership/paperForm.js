// Wording and keys of the club's paper membership form
// ("224 Clubhouse Membership Form"). The keys must match place_membership
// (migration 20261005130000_paper_membership_form.sql).

export const CONSUMPTION_REASONS = [
  { key: 'personal_wellness', label: 'Personal wellness' },
  { key: 'recreational', label: 'Recreational purposes' },
  { key: 'medical', label: 'Medical reasons' },
  { key: 'other', label: 'Other' },
]

export const CONSENTS = [
  { key: 'age_21', text: 'I confirm that I am 21 years of age or older.' },
  { key: 'private_club', text: 'I understand that 224 Clubhouse is a private cannabis club operating within legal guidelines.' },
  { key: 'no_redistribution', text: 'I will not redistribute cannabis obtained through the Club.' },
  { key: 'personal_use', text: 'I accept that any cannabis products are for personal use only.' },
  { key: 'code_of_conduct', text: "I understand and accept the Club's code of conduct and privacy policy." },
  { key: 'release_liability', text: 'I release 224 Clubhouse from any liability related to personal use or effects of cannabis.' },
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
