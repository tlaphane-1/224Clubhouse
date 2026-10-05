import tailwindConfig from '../../../tailwind.config.js'
import { BRAND_IMAGES } from '../../hooks/useStorageImages'
import { formatTierPrice } from '../../utils/tierPrice'
import PaperCheckbox from './PaperCheckbox'
import SignaturePad from './SignaturePad'
import { CONSENTS, CONSUMPTION_REASONS } from './paperForm'

// The club's printed "224 Clubhouse Membership Form", filled in on screen:
// same letterhead, same sections, same wording, same order. Answers are
// "handwritten" in blue ink on ruled lines. The "224 Clubhouse use only"
// block is the admin's (approved by / notes) and is not shown here.

const RULE = tailwindConfig.theme.extend.colors['paper-line']

const SECTION = 'font-bold text-print text-base mt-7 mb-3 pt-5 border-t-2 border-paper-line'
const FIELD_LABEL = 'block font-bold text-print text-sm'
const LINE_INPUT = `w-full min-h-11 bg-transparent border-0 border-b-2 px-1 font-hand text-2xl text-ink
                    placeholder:text-paper-line focus:outline-none focus:border-ink rounded-none`

function lineClass(invalid) {
  return `${LINE_INPUT} ${invalid ? 'border-red-600' : 'border-paper-line'}`
}

function ErrorNote({ show, children }) {
  if (!show) return null
  return <p className="text-red-700 text-xs mt-1">{children}</p>
}

export default function PaperApplication({ form, setForm, email, tiers, selectedSlug, onSelectTier, errors }) {
  const set = (key) => (e) => setForm(f => ({ ...f, [key]: e.target.value }))
  const digits = (key, max) => (e) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, max)
    setForm(f => ({ ...f, [key]: value }))
  }

  const toggleReason = (key, on) => setForm(f => ({
    ...f,
    reasons: on ? [...f.reasons, key] : f.reasons.filter(r => r !== key),
  }))

  const today = new Date()
  const pad = (n) => String(n).padStart(2, '0')

  return (
    <div className="bg-paper text-print rounded-md shadow-xl overflow-hidden">
      {/* Letterhead: black logo panel angled into the green band, as printed */}
      <div className="flex items-stretch bg-leaf">
        <div
          className="bg-black flex items-center pl-3 pr-8 py-2.5"
          style={{ clipPath: 'polygon(0 0, 100% 0, calc(100% - 1.25rem) 100%, 0 100%)' }}
        >
          <img src={BRAND_IMAGES.logoWide} alt="224 Clubhouse" className="h-8 sm:h-10 w-auto object-contain" />
        </div>
        <div className="flex-1 px-3 py-2 text-white text-[11px] leading-tight flex flex-col justify-center">
          <span className="font-bold text-xs">Address</span>
          <span>224 Rondebult Rd</span>
          <span>Libradene, Boksburg</span>
          <a href="mailto:224clubhouse@gmail.com" className="mt-1 font-semibold break-all hover:underline">
            224clubhouse@gmail.com
          </a>
        </div>
      </div>

      <div className="px-4 sm:px-8 pt-6 pb-8">
        <h2 className="font-bold text-lg">224 Clubhouse Membership Form</h2>
        <p className="font-bold text-sm mt-3">Welcome to 224 Clubhouse!</p>
        <p className="text-sm leading-relaxed">
          We’re excited to have you join our community of responsible cannabis users. Please complete
          the form below to apply for membership.
        </p>

        {/* ---- Personal Information ---- */}
        <h3 className={SECTION}>Personal Information</h3>
        <div className="space-y-4">
          <div>
            <label htmlFor="mem-name" className={FIELD_LABEL}>Full Name:</label>
            <input
              id="mem-name" className={lineClass(errors.full_name)} value={form.full_name}
              onChange={set('full_name')} autoComplete="name" maxLength={200}
              aria-invalid={errors.full_name || undefined}
            />
            <ErrorNote show={errors.full_name}>Please write your full name.</ErrorNote>
          </div>

          <fieldset>
            <legend className={FIELD_LABEL}>Date of Birth (21+):</legend>
            <div className="flex items-end gap-2">
              {[
                ['dob_day', 'mem-dob', 'DD', 2, 'Day', 'bday-day'],
                ['dob_month', 'mem-dob-month', 'MM', 2, 'Month', 'bday-month'],
                ['dob_year', 'mem-dob-year', 'YYYY', 4, 'Year', 'bday-year'],
              ].map(([key, id, ph, max, label, ac], i) => (
                <div key={key} className="flex items-end gap-2">
                  {i > 0 && <span aria-hidden="true" className="text-2xl text-print pb-1">/</span>}
                  <input
                    id={id} aria-label={label} inputMode="numeric" placeholder={ph} autoComplete={ac}
                    value={form[key]} onChange={digits(key, max)}
                    className={`${lineClass(errors.dob)} text-center ${max === 4 ? 'w-24' : 'w-14'}`}
                    aria-invalid={errors.dob || undefined}
                  />
                </div>
              ))}
            </div>
            <ErrorNote show={errors.dob}>
              {errors.dob === 'age' ? 'You must be 21 or older to join.' : 'Please write a valid date of birth.'}
            </ErrorNote>
          </fieldset>

          <div>
            <label htmlFor="mem-id" className={FIELD_LABEL}>ID/Passport Number:</label>
            <input
              id="mem-id" className={lineClass(errors.id_number)} value={form.id_number}
              onChange={set('id_number')} maxLength={20} autoCapitalize="characters"
              aria-invalid={errors.id_number || undefined}
            />
            <ErrorNote show={errors.id_number}>Please write your ID or passport number.</ErrorNote>
          </div>

          <div>
            <label htmlFor="mem-phone" className={FIELD_LABEL}>Phone Number:</label>
            <input
              id="mem-phone" type="tel" inputMode="tel" className={lineClass(errors.phone)} value={form.phone}
              onChange={set('phone')} autoComplete="tel" maxLength={50}
              aria-invalid={errors.phone || undefined}
            />
            <ErrorNote show={errors.phone}>Please write your phone number.</ErrorNote>
          </div>

          <div>
            <label htmlFor="mem-email" className={FIELD_LABEL}>Email Address:</label>
            <input id="mem-email" type="email" className={`${lineClass(false)} opacity-80`} value={email} readOnly />
            <p className="text-print/60 text-xs mt-1">Your account email — memberships are tied to it.</p>
          </div>

          <div>
            <label htmlFor="mem-address" className={FIELD_LABEL}>Residential Address:</label>
            {/* Ruled like the printed lines; the text sits on them. */}
            <textarea
              id="mem-address" rows={3} value={form.residential_address} onChange={set('residential_address')}
              autoComplete="street-address" maxLength={500}
              aria-invalid={errors.residential_address || undefined}
              className={`w-full bg-transparent border-0 px-1 font-hand text-2xl text-ink resize-none
                          focus:outline-none leading-[2.75rem] rounded-none
                          ${errors.residential_address ? 'outline outline-1 outline-red-600' : ''}`}
              style={{
                backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent calc(2.75rem - 2px), ${RULE} calc(2.75rem - 2px), ${RULE} 2.75rem)`,
              }}
            />
            <ErrorNote show={errors.residential_address}>Please write your residential address.</ErrorNote>
          </div>
        </div>

        {/* ---- Membership Details ---- */}
        <h3 className={SECTION}>Membership Details</h3>
        <fieldset>
          <legend className={FIELD_LABEL}>• Membership Type:</legend>
          <div className="pl-3">
            {tiers.map(t => (
              <PaperCheckbox
                key={t.slug} id={`mem-tier-${t.slug}`} type="radio" name="paper-membership-type"
                checked={selectedSlug === t.slug} onChange={() => onSelectTier(t.slug)}
              >
                {t.name} <span className="text-print/60 text-sm">({formatTierPrice(t.price_cents)})</span>
              </PaperCheckbox>
            ))}
          </div>
        </fieldset>

        <fieldset className="mt-4">
          <legend className={FIELD_LABEL}>• Do you consume cannabis for:</legend>
          <div className="pl-3">
            {CONSUMPTION_REASONS.map((r, i) => (
              <PaperCheckbox
                key={r.key} id={i === 0 ? 'mem-reasons' : `mem-reason-${r.key}`}
                checked={form.reasons.includes(r.key)} onChange={on => toggleReason(r.key, on)}
                invalid={errors.reasons}
              >
                {r.label}{r.key === 'other' ? ':' : ''}
              </PaperCheckbox>
            ))}
            {form.reasons.includes('other') && (
              <input
                id="mem-reason-other-text" aria-label="Other reason" value={form.reason_other}
                onChange={set('reason_other')} maxLength={200}
                className={`${lineClass(errors.reason_other)} ml-9 w-[calc(100%-2.25rem)]`}
                aria-invalid={errors.reason_other || undefined}
              />
            )}
            <ErrorNote show={errors.reasons}>Please tick at least one.</ErrorNote>
            <ErrorNote show={errors.reason_other}>Please describe “Other”.</ErrorNote>
          </div>
        </fieldset>

        {/* ---- Agreement & Consent ---- */}
        <h3 className={SECTION}>Agreement &amp; Consent</h3>
        <p className="text-sm mb-2">Please read and acknowledge the following:</p>
        <div>
          {CONSENTS.map((c, i) => (
            <PaperCheckbox
              key={c.key} id={i === 0 ? 'mem-consents' : `mem-consent-${c.key}`}
              checked={form.consents[c.key]}
              onChange={on => setForm(f => ({ ...f, consents: { ...f.consents, [c.key]: on } }))}
              invalid={errors.consents && !form.consents[c.key]}
            >
              {c.text}
            </PaperCheckbox>
          ))}
          <ErrorNote show={errors.consents}>Please tick every statement to apply.</ErrorNote>
        </div>

        {/* ---- Signature & Date ---- */}
        <div className="mt-7 pt-5 border-t-2 border-paper-line">
          <p className={FIELD_LABEL} id="mem-signature-label">Signature:</p>
          {form.sign_by_typing ? (
            <input
              id="mem-signature" aria-labelledby="mem-signature-label" value={form.signature_typed}
              onChange={set('signature_typed')} maxLength={200} placeholder="Type your full name"
              className={`${lineClass(errors.signature)} text-3xl`}
              aria-invalid={errors.signature || undefined}
            />
          ) : (
            <SignaturePad
              id="mem-signature" invalid={errors.signature}
              onChange={img => setForm(f => ({ ...f, signature_image: img }))}
            />
          )}
          <ErrorNote show={errors.signature}>Please sign the form.</ErrorNote>
          <button
            type="button"
            onClick={() => setForm(f => ({
              ...f, sign_by_typing: !f.sign_by_typing, signature_image: null, signature_typed: '',
            }))}
            className="focus-ring rounded min-h-11 px-2 -ml-2 text-ink underline underline-offset-2 text-sm"
          >
            {form.sign_by_typing ? 'Draw my signature instead' : 'Can’t draw? Type your name instead'}
          </button>

          <p className={`${FIELD_LABEL} mt-3`}>
            Date: <span className="font-hand font-normal text-2xl text-ink ml-1">
              {pad(today.getDate())} / {pad(today.getMonth() + 1)} / {today.getFullYear()}
            </span>
          </p>
        </div>
      </div>
    </div>
  )
}
