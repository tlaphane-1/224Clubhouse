import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, BadgeCheck, Check, ChevronDown, Clock, Crown, Star, Zap } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'
import { useMembershipTiers } from '../hooks/useMembershipTiers'
import { useMyMembership } from '../hooks/useMyMembership'
import CustomerAuth from '../components/auth/CustomerAuth'
import Modal from '../components/ui/Modal'
import StickyActionBar from '../components/ui/StickyActionBar'
import { formatTierPrice } from '../utils/tierPrice'
import { focusField } from '../utils/focusField'
import toast from 'react-hot-toast'
import EftDetails from '../components/checkout/EftDetails'
import PaperApplication from '../components/membership/PaperApplication'
import { CONSENTS, EMPTY_PAPER_FORM, paperDob } from '../components/membership/paperForm'

// Tiers are data now (membership_tiers table) — only the presentation layer
// stays client-side. Unknown future slugs fall back to the Star icon.
const TIER_ICONS = { daily: Zap, weekly: Star, monthly: Crown }
const FEATURED_SLUG = 'weekly'

// No Paystack account yet, so there is no online payment to take: members
// apply here and settle by EFT or with their next delivery (the club is closed
// until further notice). Setting VITE_PAYSTACK_PUBLIC_KEY switches the online flow back on —
// nothing else needs to change.
const PAY_ONLINE = Boolean(import.meta.env.VITE_PAYSTACK_PUBLIC_KEY)

function displayDuration(days) {
  return days === 1 ? '1 day' : `${days} days`
}

function formatDate(value) {
  if (!value) return null
  return new Date(value).toLocaleDateString('en-ZA', {
    day: 'numeric', month: 'long', year: 'numeric',
  })
}

const COMMANDMENTS = [
  'Respect the space — treat it as your own home.',
  'Respect each other — no judgement, no drama.',
  'Consume responsibly — know your limits.',
  'Keep it private — what happens at 224 stays at 224.',
  'No underage consumption. Strictly 21+.',
  'No dealing or soliciting on the premises.',
  'Support the culture — buy local, think global.',
  'Give back — uplift the community around you.',
  'Be present — people over phones.',
  'Keep the vibe — leave negativity at the door.',
  'Honour the plant — consume with intention.',
  'Hold each other accountable — we are family.',
]

export default function Membership() {
  const { user, loading: authLoading } = useAuth()
  const queryClient = useQueryClient()
  const { data: tiers, isLoading: tiersLoading, isError: tiersError, refetch: refetchTiers } = useMembershipTiers()
  const {
    current: myMembership,
    latest: latestMembership,
    effectiveStatus,
    isLoading: membershipLoading,
    isSuccess: membershipResolved,
    isError: membershipError,
  } = useMyMembership()

  const [selected, setSelected] = useState(null)
  const [step, setStep] = useState('tiers') // 'tiers' | 'form' | 'success'
  const [loading, setLoading] = useState(false)
  const [showRules, setShowRules] = useState(false)
  const [form, setForm] = useState(EMPTY_PAPER_FORM)
  // Per-field problems, shown on the paper form after a submit attempt.
  const [errors, setErrors] = useState({})

  useEffect(() => { document.title = 'Membership | 224 Clubhouse' }, [])

  // Paystack's script is fetched only when online payment is switched on.
  // It used to sit in index.html, render-blocking every page for every
  // visitor (mostly on phones) while payments were off.
  useEffect(() => {
    if (!PAY_ONLINE || window.PaystackPop) return
    const script = document.createElement('script')
    script.src = 'https://js.paystack.co/v1/inline.js'
    script.async = true
    document.head.appendChild(script)
  }, [])

  // Default the selection once tiers arrive: featured tier if present, else first.
  useEffect(() => {
    if (!selected && tiers?.length) {
      const featured = tiers.find(t => t.slug === FEATURED_SLUG)
      setSelected((featured ?? tiers[0]).slug)
    }
  }, [tiers, selected])

  const tier = tiers?.find(t => t.slug === selected)

  // Mirrors the RPC's `dob > current_date - interval '21 years'` rejection
  // exactly, day-of-month included. A year+month-only check let anyone up to
  // ~30 days short of 21 through to Paystack and only failed server-side —
  // after the card was charged. Dates are built from the parts (the input is
  // always YYYY-MM-DD) so no UTC-vs-local parsing shifts the day.
  function validateAge(dob) {
    const [y, m, d] = String(dob).split('-').map(Number)
    if (!y || !m || !d) return false
    const today = new Date()
    const cutoff = new Date(today.getFullYear() - 21, today.getMonth(), today.getDate())
    return new Date(y, m - 1, d) <= cutoff
  }

  // Creates the pending application. `reference` is the Paystack reference when
  // paid online, or null when the member pays by EFT / on delivery.
  async function submitApplication(reference) {
    try {
      const { data, error } = await supabase.rpc('place_membership', {
        p_customer: {
          full_name: form.full_name.trim(),
          phone: form.phone.trim(),
          date_of_birth: paperDob(form),
          id_number: form.id_number.trim(),
          residential_address: form.residential_address.trim(),
          consumption_reasons: form.reasons,
          consumption_other: form.reasons.includes('other') ? form.reason_other.trim() : null,
          consents: form.consents,
          signature_image: form.sign_by_typing ? null : form.signature_image,
          signature_typed: form.sign_by_typing ? form.signature_typed.trim() : null,
        },
        p_tier: tier.slug,
        p_reference: reference,
      })
      if (error) throw error
      // Tell the club there's an application to approve — fire and forget;
      // the application stands with or without the alert.
      if (data?.id) {
        supabase.functions
          .invoke('send-membership-application-alert', { body: { membershipId: data.id } })
          .catch(() => {})
      }
      queryClient.invalidateQueries({ queryKey: ['my-membership'] })
      setStep('success')
    } catch (err) {
      const msg = err?.message || ''
      if (/already have a pending or active membership/i.test(msg)
        || /memberships_one_pending_per_user|duplicate key/i.test(msg)) {
        // Another tab/device applied first — refresh so the status card shows.
        toast.error(
          PAY_ONLINE
            ? 'You already have a pending or active membership. If you were charged twice, contact us for a refund.'
            : 'You already have a pending or active membership on this account.',
        )
        queryClient.invalidateQueries({ queryKey: ['my-membership'] })
        setStep('tiers')
      } else if (/sign in required/i.test(msg)) {
        toast.error('Your session expired — please sign in again, then apply.')
      } else if (PAY_ONLINE) {
        toast.error('Payment received but registration failed. Please contact us.')
      } else {
        toast.error('We could not submit your application. Please try again.')
      }
      console.error(err)
    }
  }

  function handlePay() {
    if (!tier) return
    if (!user) {
      // Render gate shows CustomerAuth instead of the form; server enforces regardless.
      toast.error('Please sign in to apply for membership.')
      return
    }
    if (!membershipResolved) {
      // `myMembership` is null while the query is still in flight (e.g. they
      // signed in inside the sheet), so a truthiness check alone would let a
      // duplicate application reach Paystack and be charged before the RPC
      // rejects it. Nothing opens until we actually know.
      toast.error(
        membershipError
          ? 'We could not check your membership status. Please refresh and try again.'
          : 'Checking your membership status — one moment.',
      )
      return
    }
    if (myMembership) {
      // Guard BEFORE Paystack opens — never take payment the RPC will reject.
      toast.error('You already have a pending or active membership on this account.')
      setStep('tiers')
      return
    }
    // Everything the paper form asks for, checked in on-screen order; mark
    // every gap and jump to the first (on a phone it is usually off screen).
    const dob = paperDob(form)
    const found = {}
    if (!form.full_name.trim()) found.full_name = 'mem-name'
    if (!dob) found.dob = 'mem-dob'
    else if (!validateAge(dob)) found.dob = 'mem-dob'
    if (!form.id_number.trim()) found.id_number = 'mem-id'
    if (!form.phone.trim()) found.phone = 'mem-phone'
    if (!form.residential_address.trim()) found.residential_address = 'mem-address'
    if (form.reasons.length === 0) found.reasons = 'mem-reasons'
    else if (form.reasons.includes('other') && !form.reason_other.trim()) found.reason_other = 'mem-reason-other-text'
    if (CONSENTS.some(c => !form.consents[c.key])) found.consents = 'mem-consents'
    const signed = form.sign_by_typing ? form.signature_typed.trim() : form.signature_image
    if (!signed) found.signature = 'mem-signature'
    const keys = Object.keys(found)
    setErrors(Object.fromEntries(keys.map(k => [k, k === 'dob' && dob ? 'age' : true])))
    if (keys.length) {
      toast.error(found.dob && dob ? 'You must be 21 or older to join 224 Clubhouse.' : 'Please complete the highlighted parts of the form.')
      focusField(found[keys[0]])
      return
    }

    // With no Paystack account yet there is no online payment to take, and
    // every application waits for admin approval anyway — so the application
    // is submitted here and settled by EFT or on delivery. The moment
    // VITE_PAYSTACK_PUBLIC_KEY is set, the Paystack path below takes over.
    if (!PAY_ONLINE) {
      setLoading(true)
      submitApplication(null).finally(() => setLoading(false))
      return
    }

    if (!window.PaystackPop) {
      toast.error('Payment system not loaded. Please refresh the page.')
      return
    }

    const reference = `224-mem-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    setLoading(true)

    const handler = window.PaystackPop.setup({
      key: import.meta.env.VITE_PAYSTACK_PUBLIC_KEY,
      email: user.email, // account email is authoritative (server overrides it anyway)
      amount: tier.price_cents,
      currency: 'ZAR',
      ref: reference,
      metadata: {
        custom_fields: [
          { display_name: 'Full Name', variable_name: 'full_name', value: form.full_name },
          { display_name: 'Tier', variable_name: 'tier', value: tier.name },
        ],
      },
      callback: (response) => {
        submitApplication(response.reference).finally(() => setLoading(false))
      },
      onClose: () => setLoading(false),
    })
    handler.openIframe()
  }

  if (step === 'success') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4 pt-20 pb-12">
        <div className="max-w-md w-full text-center bg-surface border border-gold/30 rounded-2xl p-6 sm:p-10 animate-scaleIn">
          <div className="w-16 h-16 bg-gold/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <Crown size={32} className="text-gold" />
          </div>
          <h1 className="font-heading text-3xl font-bold text-white mb-3">Application Received</h1>
          <p className="text-muted leading-relaxed mb-2">
            Thanks <span className="text-white">{form.full_name.split(' ')[0]}</span>! We've received your{' '}
            <span className="text-gold font-semibold">{tier?.name}</span> membership application and will confirm it shortly.
          </p>
          <p className="text-muted text-sm leading-relaxed mb-8">
            {PAY_ONLINE
              ? 'Your membership starts the moment we confirm it — you can check its status right here any time.'
              : `Pay ${tier ? formatTierPrice(tier.price_cents) : ''} by EFT, or pay the driver with your next delivery. We'll activate your membership as soon as payment is received — check its status here any time.`}
          </p>
          {!PAY_ONLINE && (
            <div className="mb-8">
              <EftDetails
                reference={form.full_name || 'your full name'}
                amountLabel={tier ? formatTierPrice(tier.price_cents) : null}
              />
            </div>
          )}
          <a href="/" className="btn-gold w-full py-3 text-sm uppercase tracking-widest">
            Back to Home
          </a>
        </div>
      </div>
    )
  }

  // Display uses `latest` (includes a lapsed membership); `current` stays the
  // strict may-apply check, so an expired member still gets the apply CTA.
  const membershipTierName =
    tiers?.find(t => t.id === latestMembership?.tier_id || t.slug === latestMembership?.tier)?.name
    ?? latestMembership?.tier

  const canApply = Boolean(tier) && !myMembership
  const applyLabel = tier ? `${effectiveStatus === 'expired' ? 'Renew' : 'Apply for'} ${tier.name} — ${formatTierPrice(tier.price_cents)}` : ''
  const applyButton = (
    <button
      type="button"
      onClick={() => setStep('form')}
      disabled={Boolean(user) && membershipLoading}
      className="btn-gold w-full md:w-auto md:px-12 py-4 text-sm uppercase tracking-widest disabled:opacity-50"
    >
      {applyLabel}
    </button>
  )
  const payNote = !PAY_ONLINE && (
    <p className="text-muted text-xs text-center mt-2 md:mt-3">Apply online — pay by EFT or with your next delivery.</p>
  )

  // The application sheet: sign-in gate first, then the form (account email is fixed).
  const showForm = Boolean(user) && membershipResolved && !myMembership
  const sheetTitle = authLoading
    ? 'Membership'
    : !user ? 'Join 224 Clubhouse'
      : !membershipResolved ? (membershipError ? 'Something went wrong' : 'One moment')
        : myMembership ? "You're already a member"
          : `${tier?.name} Application`

  return (
    // No transform on this wrapper: it is the sticky bar's containing block.
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <section className="pt-24 md:pt-32 pb-8 md:pb-16 px-4 text-center">
        <div className="animate-fadeIn">
          <p className="text-gold text-xs uppercase tracking-[0.4em] mb-3">Join The Club</p>
          <h1 className="font-heading text-4xl sm:text-5xl md:text-6xl font-bold text-white mb-4">Membership</h1>
          <div className="w-16 h-px bg-gold mx-auto mb-5 md:mb-6" />
          <p className="text-muted max-w-xl mx-auto text-base md:text-lg leading-relaxed">
            224 Clubhouse is a private members' club. Members get free delivery, members-only products and first access to new drops and events. Pick the pass that suits you.
          </p>
        </div>
      </section>

      {/* Requirements Banner */}
      <div className="bg-gold/5 border-y border-gold/20 py-3 md:py-4 px-4 text-center">
        <p className="text-gold text-xs sm:text-sm">
          <span className="font-semibold">Requirements:</span> Must be 21 years or older · Personal use only · Agreement to the 12 Club Commandments
        </p>
      </div>

      {/* Tiers */}
      <section className="pt-8 pb-6 md:py-20 px-4">
        <div className="max-w-5xl mx-auto">
          {tiersLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-6" role="status" aria-label="Loading membership options">
              {[0, 1, 2].map(i => <div key={i} className="h-20 md:h-96 skeleton rounded-2xl" />)}
            </div>
          ) : tiersError || !tiers?.length ? (
            <div className="bg-surface border border-red-500/20 rounded-2xl p-8 text-center max-w-md mx-auto">
              <AlertTriangle size={28} className="text-red-400 mx-auto mb-3" />
              <p className="text-white text-sm mb-5">
                Membership options couldn't load. Please check your connection and try again.
              </p>
              <button type="button" onClick={() => refetchTiers()} className="btn-gold text-sm">
                Retry
              </button>
            </div>
          ) : (
            <>
              {/* Choose a tier: real radio buttons (keyboard and screen readers
                  work natively). Phones get compact rows; desktop gets cards. */}
              <fieldset>
                <legend className="sr-only">Choose a membership</legend>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-6">
                  {tiers.map((t) => {
                    const Icon = TIER_ICONS[t.slug] ?? Star
                    const featured = t.slug === FEATURED_SLUG
                    const isSelected = selected === t.slug
                    return (
                      <label key={t.slug} className="relative block cursor-pointer">
                        <input
                          type="radio"
                          name="membership-tier"
                          value={t.slug}
                          checked={isSelected}
                          onChange={() => setSelected(t.slug)}
                          className="peer sr-only"
                        />
                        <div
                          className={`h-full bg-surface border-2 rounded-2xl p-4 md:p-8 transition-all duration-200 active:scale-[0.98]
                                      peer-focus-visible:ring-2 peer-focus-visible:ring-gold peer-focus-visible:ring-offset-2
                                      peer-focus-visible:ring-offset-background ${
                                        isSelected
                                          ? 'border-gold shadow-glow bg-gold/5'
                                          : featured
                                            ? 'border-gold/50 hover:border-gold'
                                            : 'border-border hover:border-gold/60'
                                      }`}
                        >
                          {featured && (
                            <span className="absolute -top-2.5 right-4 md:right-auto md:left-1/2 md:-translate-x-1/2 bg-gold text-black text-[10px] font-bold uppercase tracking-widest px-3 py-0.5 rounded-full">
                              Most Popular
                            </span>
                          )}
                          <div className="flex items-center gap-4 md:block">
                            <div className={`flex-shrink-0 w-11 h-11 md:w-12 md:h-12 rounded-xl flex items-center justify-center md:mb-5 ${isSelected ? 'bg-gold' : 'bg-gold/10'}`}>
                              <Icon size={22} className={isSelected ? 'text-black' : 'text-gold'} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <h3 className="font-heading text-lg md:text-xl font-bold text-white md:mb-1">{t.name}</h3>
                              <p className="text-muted text-xs uppercase tracking-widest md:mb-4">{displayDuration(t.duration_days)} access</p>
                            </div>
                            <div className="font-heading text-2xl md:text-4xl font-bold text-gold md:mb-6">{formatTierPrice(t.price_cents)}</div>
                            {/* Phone radio indicator */}
                            <span
                              aria-hidden="true"
                              className={`md:hidden flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center ${
                                isSelected ? 'border-gold' : 'border-muted/60'
                              }`}
                            >
                              {isSelected && <span className="w-3 h-3 rounded-full bg-gold" />}
                            </span>
                          </div>
                          <ul className="hidden md:block space-y-2.5">
                            {t.perks.map(perk => (
                              <li key={perk} className="flex items-start gap-2.5 text-sm text-muted">
                                <Check size={14} className="text-gold mt-0.5 shrink-0" />
                                {perk}
                              </li>
                            ))}
                          </ul>
                          {isSelected && (
                            <div className="hidden md:block mt-6 pt-4 border-t border-gold/20 text-center">
                              <span className="text-gold text-xs uppercase tracking-widest font-semibold">Selected</span>
                            </div>
                          )}
                        </div>
                      </label>
                    )
                  })}
                </div>
              </fieldset>

              {/* Phones: what the chosen tier includes, under the list */}
              {tier && tier.perks.length > 0 && (
                <div className="md:hidden mt-4 bg-surface border border-border rounded-2xl p-5" aria-live="polite">
                  <p className="text-gold text-xs uppercase tracking-widest mb-3">With {tier.name} you get</p>
                  <ul className="space-y-2.5">
                    {tier.perks.map(perk => (
                      <li key={perk} className="flex items-start gap-2.5 text-sm text-white/90">
                        <Check size={14} className="text-leaf mt-0.5 shrink-0" />
                        {perk}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}

          {/* The membership status card (live OR lapsed) */}
          {user && latestMembership && (
            <div className={`max-w-lg mx-auto mt-6 md:mt-10 bg-surface border rounded-2xl p-6 md:p-8 animate-fadeIn ${
              effectiveStatus === 'expired' ? 'border-border' : 'border-gold/30'
            }`}>
              <div className="flex items-center gap-3 mb-5">
                {effectiveStatus === 'active' ? (
                  <BadgeCheck size={24} className="text-gold shrink-0" />
                ) : (
                  <Clock size={24} className="text-gold shrink-0" />
                )}
                <h2 className="font-heading text-2xl font-bold text-white">Your Membership</h2>
              </div>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between gap-4">
                  <span className="text-muted uppercase tracking-widest text-xs pt-0.5">Tier</span>
                  <span className="text-white font-semibold capitalize">{membershipTierName}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted uppercase tracking-widest text-xs pt-0.5">Status</span>
                  {effectiveStatus === 'pending' && (
                    <span className="text-gold font-semibold">Awaiting confirmation</span>
                  )}
                  {effectiveStatus === 'active' && (
                    <span className="text-gold font-semibold">
                      Active{latestMembership.expires_at ? ` — until ${formatDate(latestMembership.expires_at)}` : ''}
                    </span>
                  )}
                  {effectiveStatus === 'expired' && (
                    <span className="text-muted font-semibold">
                      Expired{latestMembership.expires_at ? ` on ${formatDate(latestMembership.expires_at)}` : ''}
                    </span>
                  )}
                </div>
                {latestMembership.created_at && (
                  <div className="flex justify-between gap-4">
                    <span className="text-muted uppercase tracking-widest text-xs pt-0.5">Applied</span>
                    <span className="text-white">{formatDate(latestMembership.created_at)}</span>
                  </div>
                )}
                {latestMembership.approved_at && (
                  <div className="flex justify-between gap-4">
                    <span className="text-muted uppercase tracking-widest text-xs pt-0.5">Approved</span>
                    <span className="text-white">{formatDate(latestMembership.approved_at)}</span>
                  </div>
                )}
              </div>
              <p className="text-muted text-xs leading-relaxed mt-6">
                {effectiveStatus === 'pending' &&
                  'We’ll confirm your application shortly — your membership clock only starts once it’s approved.'}
                {effectiveStatus === 'active' &&
                  'You get free delivery on every order while your membership is active. Contact us if anything looks wrong.'}
                {effectiveStatus === 'expired' &&
                  'Your access has ended. Pick a tier above to renew — you keep the same account.'}
              </p>
            </div>
          )}

          {/* Desktop apply / renew (phones use the sticky bar below) */}
          {canApply && (
            <div className="hidden md:block text-center mt-10">
              {applyButton}
              {payNote}
            </div>
          )}
        </div>
      </section>

      {/* Phone apply bar — right after the tier choice in reading/focus order */}
      {canApply && (
        <StickyActionBar hideFrom="md">
          {applyButton}
          {payNote}
        </StickyActionBar>
      )}

      {/* Application sheet: full screen on phones, a centred window from sm up */}
      <Modal
        isOpen={step === 'form' && Boolean(tier)}
        onClose={() => setStep('tiers')}
        title={sheetTitle}
        size="md"
        sheet
        footer={showForm && (
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStep('tiers')}
              className="btn-outline px-5 py-3 text-sm uppercase tracking-widest"
            >
              Back
            </button>
            <button
              type="button"
              onClick={handlePay}
              disabled={loading}
              className="btn-gold flex-1 py-3 text-sm uppercase tracking-widest disabled:opacity-50"
            >
              {loading
                ? (PAY_ONLINE ? 'Processing...' : 'Submitting...')
                : PAY_ONLINE
                  ? `Pay ${formatTierPrice(tier.price_cents)}`
                  : `Submit — ${formatTierPrice(tier.price_cents)}`}
            </button>
          </div>
        )}
      >
        {authLoading ? (
          <div className="flex justify-center py-10">
            <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
          </div>
        ) : !user ? (
          <>
            <CustomerAuth
              title="Sign in to apply"
              subtitle="Your membership is tied to your account, so you can check its status here any time."
            />
            <button
              type="button"
              onClick={() => setStep('tiers')}
              className="btn-outline w-full mt-4 py-3 text-sm uppercase tracking-widest"
            >
              Back
            </button>
          </>
        ) : !membershipResolved ? (
          // Signed in but we don't yet know whether they already hold a
          // membership — never show a payable form on an unresolved query.
          membershipError ? (
            <>
              <p className="text-muted text-sm mb-6">
                We couldn’t check your membership status. Please refresh the page and try again.
              </p>
              <button
                type="button"
                onClick={() => setStep('tiers')}
                className="btn-outline w-full py-3 text-sm uppercase tracking-widest"
              >
                Back
              </button>
            </>
          ) : (
            <div className="flex flex-col items-center gap-4 py-10" role="status">
              <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
              <p className="text-muted text-sm">Checking your membership status…</p>
            </div>
          )
        ) : myMembership ? (
          // They signed in mid-flow and already hold one — no second application.
          <>
            <p className="text-muted text-sm mb-6">
              This account already has a {effectiveStatus === 'pending' ? 'pending application' : 'membership'}.
              Close this window to see its status.
            </p>
            <button
              type="button"
              onClick={() => setStep('tiers')}
              className="btn-gold w-full py-3 text-sm uppercase tracking-widest"
            >
              View my membership
            </button>
          </>
        ) : (
          <>
            <p className="text-muted text-sm mb-4">
              This is our paper membership form — fill it in and sign it on screen.
              {PAY_ONLINE ? '' : ' You pay by EFT or with your next delivery.'}
            </p>
            <PaperApplication
              form={form}
              setForm={setForm}
              email={user.email ?? ''}
              tiers={tiers ?? []}
              selectedSlug={selected}
              onSelectTier={setSelected}
              errors={errors}
            />
          </>
        )}
      </Modal>

      {/* Commandments Section — folded away on phones to keep the page short */}
      <section className="py-12 md:py-20 px-4 bg-surface border-y border-border">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-6 md:mb-12">
            <p className="text-gold text-xs uppercase tracking-[0.4em] mb-3">The Code</p>
            <h2 className="section-heading text-white">12 Club Commandments</h2>
          </div>
          <button
            type="button"
            onClick={() => setShowRules(o => !o)}
            aria-expanded={showRules}
            aria-controls="commandments-list"
            className="focus-ring md:hidden w-full flex items-center justify-between gap-3 h-12 px-4 bg-background
                       border border-border rounded-xl text-sm text-white"
          >
            {showRules ? 'Hide' : 'Read'} the 12 Club Commandments
            <ChevronDown size={16} className={`text-gold transition-transform ${showRules ? 'rotate-180' : ''}`} />
          </button>
          <div
            id="commandments-list"
            className={`${showRules ? 'grid mt-3' : 'hidden'} md:grid md:mt-0 grid-cols-1 md:grid-cols-2 gap-3 md:gap-4`}
          >
            {COMMANDMENTS.map((c, i) => (
              <div key={i} className="flex items-start gap-4 bg-background border border-border rounded-xl p-4 md:p-5">
                <span className="font-heading text-2xl font-bold text-gold/30 leading-none">{String(i + 1).padStart(2, '0')}</span>
                <p className="text-white/80 text-sm leading-relaxed">{c}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
