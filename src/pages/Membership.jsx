import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, Check, Clock, Crown, Star, Zap } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useMembershipTiers } from '../hooks/useMembershipTiers'
import { useMyMembership } from '../hooks/useMyMembership'
import CustomerAuth from '../components/auth/CustomerAuth'
import { formatZAR } from '../utils/formatCurrency'
import toast from 'react-hot-toast'

// Tiers are data now (membership_tiers table) — only the presentation layer
// stays client-side. Unknown future slugs fall back to the Star icon.
const TIER_ICONS = { daily: Zap, weekly: Star, monthly: Crown }
const FEATURED_SLUG = 'weekly'

// No Paystack account yet, so there is no online payment to take: members
// apply here and settle at the club, which is also how the lounge already
// works. Setting VITE_PAYSTACK_PUBLIC_KEY switches the online flow back on —
// nothing else needs to change.
const PAY_ONLINE = Boolean(import.meta.env.VITE_PAYSTACK_PUBLIC_KEY)

// Prices are whole rands today (R10/R30/R50) — keep the compact "R10" look,
// but fall back to full cents formatting if an admin ever sets e.g. 1050.
function displayPrice(cents) {
  return cents % 100 === 0 ? `R${cents / 100}` : formatZAR(cents)
}

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
  const { data: tiers, isLoading: tiersLoading, isError: tiersError } = useMembershipTiers()
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
  const [form, setForm] = useState({
    full_name: '', phone: '', date_of_birth: '', id_number: '', agreed: false,
  })

  useEffect(() => { document.title = 'Membership | 224 Clubhouse' }, [])

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

  function handleFormChange(e) {
    const { name, value, type, checked } = e.target
    setForm(f => ({ ...f, [name]: type === 'checkbox' ? checked : value }))
  }

  // Creates the pending application. `reference` is the Paystack reference when
  // paid online, or null when the member settles at the club.
  async function submitApplication(reference) {
    try {
      const { error } = await supabase.rpc('place_membership', {
        p_customer: {
          full_name: form.full_name,
          phone: form.phone,
          date_of_birth: form.date_of_birth,
          id_number: form.id_number || null,
        },
        p_tier: tier.slug,
        p_reference: reference,
      })
      if (error) throw error
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
      // signed in inside the modal), so a truthiness check alone would let a
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
    if (!form.full_name || !form.phone || !form.date_of_birth) {
      toast.error('Please fill in all required fields.')
      return
    }
    if (!validateAge(form.date_of_birth)) {
      toast.error('You must be 21 or older to join 224 Clubhouse.')
      return
    }
    if (!form.agreed) {
      toast.error('You must agree to the 12 Club Commandments.')
      return
    }

    // Pay-at-the-club: with no Paystack account yet there is no online payment
    // to take, and every application waits for admin approval anyway — so the
    // application is submitted here and settled in person. The moment
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
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div
          className="max-w-md w-full text-center bg-surface border border-gold/30 rounded-2xl p-10 animate-scaleIn"
        >
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
              : `Pay ${tier ? displayPrice(tier.price_cents) : ''} at the club and we'll activate it on the spot. Your membership starts the moment we confirm it — check its status here any time.`}
          </p>
          <div className="bg-gold/5 border border-gold/20 rounded-xl p-4 mb-8">
            <p className="text-gold text-xs uppercase tracking-widest mb-2">Address</p>
            <p className="text-white text-sm">224 Rondebult Ave, Libradene, Boksburg, 1459</p>
          </div>
          <a href="/" className="btn-gold w-full py-3 text-sm uppercase tracking-widest inline-block">
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

  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <section className="pt-32 pb-16 px-4 text-center">
        <div className="animate-fadeIn">
          <p className="text-gold text-xs uppercase tracking-[0.4em] mb-3">Join The Club</p>
          <h1 className="font-heading text-5xl md:text-6xl font-bold text-white mb-4">Membership</h1>
          <div className="w-16 h-px bg-gold mx-auto mb-6" />
          <p className="text-muted max-w-xl mx-auto text-lg leading-relaxed">
            224 Clubhouse is a private, members-based space designed for community, connection, and curated experiences. Choose your level of access.
          </p>
        </div>
      </section>

      {/* Requirements Banner */}
      <div className="bg-gold/5 border-y border-gold/20 py-4 px-4 text-center">
        <p className="text-gold text-sm">
          <span className="font-semibold">Requirements:</span> Must be 21 years or older · Personal use only · Agreement to the 12 Club Commandments
        </p>
      </div>

      {/* Tiers */}
      <section className="py-20 px-4">
        <div className="max-w-5xl mx-auto">
          {tiersLoading ? (
            <div className="flex justify-center py-16">
              <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
            </div>
          ) : tiersError || !tiers?.length ? (
            <p className="text-muted text-center py-16">
              Membership tiers are unavailable right now. Please try again shortly.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {tiers.map((t) => {
                const Icon = TIER_ICONS[t.slug] ?? Star
                const featured = t.slug === FEATURED_SLUG
                const isSelected = selected === t.slug
                return (
                  <div
                    key={t.slug}
                    onClick={() => setSelected(t.slug)}
                    className={`relative cursor-pointer bg-surface border-2 rounded-2xl p-8 transition-all duration-200 animate-fadeIn ${
                      isSelected
                        ? 'border-gold shadow-xl shadow-gold/10'
                        : featured
                          ? 'border-gold/50 hover:border-gold'
                          : 'border-border hover:border-gold/60'
                    }`}
                  >
                    {featured && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gold text-black text-[10px] font-bold uppercase tracking-widest px-4 py-1 rounded-full">
                        Most Popular
                      </div>
                    )}
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-5 ${isSelected ? 'bg-gold' : 'bg-gold/10'}`}>
                      <Icon size={22} className={isSelected ? 'text-black' : 'text-gold'} />
                    </div>
                    <h3 className="font-heading text-xl font-bold text-white mb-1">{t.name}</h3>
                    <p className="text-muted text-xs uppercase tracking-widest mb-4">{displayDuration(t.duration_days)} access</p>
                    <div className="font-heading text-4xl font-bold text-gold mb-6">{displayPrice(t.price_cents)}</div>
                    <ul className="space-y-2.5">
                      {t.perks.map(perk => (
                        <li key={perk} className="flex items-start gap-2.5 text-sm text-muted">
                          <Check size={14} className="text-gold mt-0.5 shrink-0" />
                          {perk}
                        </li>
                      ))}
                    </ul>
                    {isSelected && (
                      <div className="mt-6 pt-4 border-t border-gold/20 text-center">
                        <span className="text-gold text-xs uppercase tracking-widest font-semibold">Selected</span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Below the grid: the membership status card (live OR lapsed), and —
              whenever there is no live membership — the apply/renew CTA. */}
          {user && latestMembership && (
            <div className={`max-w-lg mx-auto mt-10 bg-surface border rounded-2xl p-8 animate-fadeIn ${
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
                  'Present your membership at the door on arrival. Contact us if anything looks wrong.'}
                {effectiveStatus === 'expired' &&
                  'Your access has ended. Pick a tier above to renew — you keep the same account.'}
              </p>
            </div>
          )}

          {/* No live membership (never joined, or lapsed) → apply / renew */}
          {tier && !myMembership && (
            <div className="text-center mt-10">
              <button
                onClick={() => setStep('form')}
                disabled={Boolean(user) && membershipLoading}
                className="btn-gold px-12 py-4 text-sm uppercase tracking-widest disabled:opacity-50"
              >
                {effectiveStatus === 'expired' ? 'Renew' : 'Apply for'} {tier.name} — {displayPrice(tier.price_cents)}
              </button>
              {!PAY_ONLINE && (
                <p className="text-muted text-xs mt-3">
                  Apply online — pay at the club when you collect your membership.
                </p>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Application Modal: sign-in gate, then the form (account email is fixed) */}
      {step === 'form' && tier && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div
            className="bg-surface border border-border rounded-2xl p-8 w-full max-w-lg max-h-[90vh] overflow-y-auto animate-scaleIn"
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
                  <h2 className="font-heading text-2xl font-bold text-white mb-2">Something went wrong</h2>
                  <p className="text-muted text-sm mb-6">
                    We couldn’t check your membership status. Please refresh the page and try again.
                  </p>
                  <button
                    onClick={() => setStep('tiers')}
                    className="btn-outline w-full py-3 text-sm uppercase tracking-widest"
                  >
                    Back
                  </button>
                </>
              ) : (
                <div className="flex flex-col items-center gap-4 py-10">
                  <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
                  <p className="text-muted text-sm">Checking your membership status…</p>
                </div>
              )
            ) : myMembership ? (
              // They signed in mid-flow and already hold one — no second application.
              <>
                <h2 className="font-heading text-2xl font-bold text-white mb-2">You're already a member</h2>
                <p className="text-muted text-sm mb-6">
                  This account already has a {effectiveStatus === 'pending' ? 'pending application' : 'membership'}.
                  Close this window to see its status.
                </p>
                <button
                  onClick={() => setStep('tiers')}
                  className="btn-gold w-full py-3 text-sm uppercase tracking-widest"
                >
                  View my membership
                </button>
              </>
            ) : (
              <>
                <h2 className="font-heading text-2xl font-bold text-white mb-1">
                  {tier.name} Application
                </h2>
                <p className="text-muted text-sm mb-6">Complete your details to proceed to payment.</p>

                <div className="space-y-4">
                  <div>
                    <label className="text-xs text-muted uppercase tracking-widest block mb-1.5">Full Name *</label>
                    <input className="input-base" name="full_name" value={form.full_name} onChange={handleFormChange} placeholder="Your full name" />
                  </div>
                  <div>
                    <label className="text-xs text-muted uppercase tracking-widest block mb-1.5">Email Address</label>
                    <input
                      className="input-base opacity-60 cursor-not-allowed"
                      type="email"
                      value={user.email ?? ''}
                      disabled
                    />
                    <p className="text-muted text-xs mt-1">Memberships are tied to your account email.</p>
                  </div>
                  <div>
                    <label className="text-xs text-muted uppercase tracking-widest block mb-1.5">Phone Number *</label>
                    <input className="input-base" type="tel" name="phone" value={form.phone} onChange={handleFormChange} placeholder="0XX XXX XXXX" />
                  </div>
                  <div>
                    <label className="text-xs text-muted uppercase tracking-widest block mb-1.5">Date of Birth * (Must be 21+)</label>
                    <input className="input-base" type="date" name="date_of_birth" value={form.date_of_birth} onChange={handleFormChange} />
                  </div>
                  <div>
                    <label className="text-xs text-muted uppercase tracking-widest block mb-1.5">SA ID Number (optional)</label>
                    <input className="input-base" name="id_number" value={form.id_number} onChange={handleFormChange} placeholder="13-digit ID number" maxLength={13} />
                  </div>

                  {/* Commandments agreement */}
                  <div className="bg-background border border-border rounded-xl p-4">
                    <p className="text-gold text-xs uppercase tracking-widest mb-3">The 12 Club Commandments</p>
                    <ol className="space-y-1.5 mb-4">
                      {COMMANDMENTS.map((c, i) => (
                        <li key={i} className="text-muted text-xs flex gap-2">
                          <span className="text-gold shrink-0">{i + 1}.</span>{c}
                        </li>
                      ))}
                    </ol>
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        name="agreed"
                        checked={form.agreed}
                        onChange={handleFormChange}
                        className="mt-0.5 accent-[#C9A84C]"
                      />
                      <span className="text-white text-sm">I have read and agree to the 12 Club Commandments and the terms of membership.</span>
                    </label>
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={() => setStep('tiers')}
                      className="btn-outline flex-1 py-3 text-sm uppercase tracking-widest"
                    >
                      Back
                    </button>
                    <button
                      onClick={handlePay}
                      disabled={loading}
                      className="btn-gold flex-1 py-3 text-sm uppercase tracking-widest disabled:opacity-50"
                    >
                      {loading
                        ? (PAY_ONLINE ? 'Processing...' : 'Submitting...')
                        : PAY_ONLINE
                          ? `Pay ${displayPrice(tier.price_cents)}`
                          : `Submit application — ${displayPrice(tier.price_cents)} at the club`}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Commandments Section */}
      <section className="py-20 px-4 bg-surface border-y border-border">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-gold text-xs uppercase tracking-[0.4em] mb-3">The Code</p>
            <h2 className="section-heading text-white">12 Club Commandments</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {COMMANDMENTS.map((c, i) => (
              <div key={i} className="flex items-start gap-4 bg-background border border-border rounded-xl p-5">
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
