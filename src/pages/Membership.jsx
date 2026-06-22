import { useEffect, useState } from 'react'
import { Check, Crown, Star, Zap } from 'lucide-react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'

const TIERS = [
  {
    id: 'daily',
    label: 'Daily Pass',
    price: 1000,
    display: 'R10',
    icon: Zap,
    duration: '1 day',
    color: 'border-border hover:border-gold/60',
    perks: [
      'Single-day lounge access',
      'Access to the full floor',
      'Participation in daily sessions',
      'Meet the community',
    ],
  },
  {
    id: 'weekly',
    label: 'Weekly Member',
    price: 3000,
    display: 'R30',
    icon: Star,
    duration: '7 days',
    color: 'border-gold/50 hover:border-gold',
    featured: true,
    perks: [
      '7-day lounge access',
      'Event invitations',
      'Member pricing on products',
      'Lounge Wi-Fi + amenities',
      'Priority seating',
    ],
  },
  {
    id: 'monthly',
    label: 'Monthly Member',
    price: 5000,
    display: 'R50',
    icon: Crown,
    duration: '30 days',
    color: 'border-border hover:border-gold/60',
    perks: [
      '30-day lounge access',
      'Priority event invitations',
      'Exclusive member perks',
      'Early access to product drops',
      'Member-only discounts',
      'Lounge Wi-Fi + amenities',
    ],
  },
]

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

function addDays(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString()
}

export default function Membership() {
  const [selected, setSelected] = useState('weekly')
  const [step, setStep] = useState('tiers') // 'tiers' | 'form' | 'success'
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    full_name: '', email: '', phone: '', date_of_birth: '', id_number: '', agreed: false,
  })

  useEffect(() => { document.title = 'Membership | 224 Clubhouse' }, [])

  const tier = TIERS.find(t => t.id === selected)

  function validateAge(dob) {
    const birthDate = new Date(dob)
    const today = new Date()
    const age = today.getFullYear() - birthDate.getFullYear()
    const m = today.getMonth() - birthDate.getMonth()
    return age > 21 || (age === 21 && m >= 0)
  }

  function handleFormChange(e) {
    const { name, value, type, checked } = e.target
    setForm(f => ({ ...f, [name]: type === 'checkbox' ? checked : value }))
  }

  function handlePay() {
    if (!form.full_name || !form.email || !form.phone || !form.date_of_birth) {
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

    if (!window.PaystackPop) {
      toast.error('Payment system not loaded. Please refresh the page.')
      return
    }

    const reference = `224-mem-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    setLoading(true)

    const handler = window.PaystackPop.setup({
      key: import.meta.env.VITE_PAYSTACK_PUBLIC_KEY,
      email: form.email,
      amount: tier.price,
      currency: 'ZAR',
      ref: reference,
      metadata: {
        custom_fields: [
          { display_name: 'Full Name', variable_name: 'full_name', value: form.full_name },
          { display_name: 'Tier', variable_name: 'tier', value: tier.label },
        ],
      },
      callback: async (response) => {
        try {
          const expiresMap = { daily: 1, weekly: 7, monthly: 30 }
          const { error } = await supabase.from('memberships').insert({
            full_name: form.full_name,
            email: form.email,
            phone: form.phone,
            date_of_birth: form.date_of_birth,
            id_number: form.id_number || null,
            tier: selected,
            status: 'active',
            amount: tier.price,
            paystack_reference: response.reference,
            expires_at: addDays(expiresMap[selected]),
          })
          if (error) throw error
          setStep('success')
        } catch (err) {
          toast.error('Payment received but registration failed. Please contact us.')
          console.error(err)
        } finally {
          setLoading(false)
        }
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
          <h1 className="font-heading text-3xl font-bold text-white mb-3">Welcome to 224</h1>
          <p className="text-muted leading-relaxed mb-2">
            Your <span className="text-gold font-semibold">{tier.label}</span> membership is active.
          </p>
          <p className="text-muted text-sm leading-relaxed mb-8">
            A confirmation has been sent to <span className="text-white">{form.email}</span>.
            Present your confirmation at the door on arrival.
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {TIERS.map((t) => {
              const Icon = t.icon
              const isSelected = selected === t.id
              return (
                <div
                  key={t.id}
                  onClick={() => setSelected(t.id)}
                  className={`relative cursor-pointer bg-surface border-2 rounded-2xl p-8 transition-all duration-200 animate-fadeIn ${
                    isSelected ? 'border-gold shadow-xl shadow-gold/10' : t.color
                  }`}
                >
                  {t.featured && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gold text-black text-[10px] font-bold uppercase tracking-widest px-4 py-1 rounded-full">
                      Most Popular
                    </div>
                  )}
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-5 ${isSelected ? 'bg-gold' : 'bg-gold/10'}`}>
                    <Icon size={22} className={isSelected ? 'text-black' : 'text-gold'} />
                  </div>
                  <h3 className="font-heading text-xl font-bold text-white mb-1">{t.label}</h3>
                  <p className="text-muted text-xs uppercase tracking-widest mb-4">{t.duration} access</p>
                  <div className="font-heading text-4xl font-bold text-gold mb-6">{t.display}</div>
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

          <div className="text-center mt-10">
            <button
              onClick={() => setStep('form')}
              className="btn-gold px-12 py-4 text-sm uppercase tracking-widest"
            >
              Apply for {tier.label} — {tier.display}
            </button>
          </div>
        </div>
      </section>

      {/* Application Form Modal */}
      {step === 'form' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div
            className="bg-surface border border-border rounded-2xl p-8 w-full max-w-lg max-h-[90vh] overflow-y-auto animate-scaleIn"
          >
            <h2 className="font-heading text-2xl font-bold text-white mb-1">
              {tier.label} Application
            </h2>
            <p className="text-muted text-sm mb-6">Complete your details to proceed to payment.</p>

            <div className="space-y-4">
              <div>
                <label className="text-xs text-muted uppercase tracking-widest block mb-1.5">Full Name *</label>
                <input className="input-base" name="full_name" value={form.full_name} onChange={handleFormChange} placeholder="Your full name" />
              </div>
              <div>
                <label className="text-xs text-muted uppercase tracking-widest block mb-1.5">Email Address *</label>
                <input className="input-base" type="email" name="email" value={form.email} onChange={handleFormChange} placeholder="your@email.com" />
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
                  {loading ? 'Processing...' : `Pay ${tier.display}`}
                </button>
              </div>
            </div>
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
