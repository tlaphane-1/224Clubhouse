import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Star, Mail, Truck, Sparkles, Crown, AlertTriangle } from 'lucide-react'
import { useProducts } from '../hooks/useProducts'
import { useCheapestTier } from '../hooks/useMembershipTiers'
import { CATEGORIES } from '../components/store/categories'
import { formatTierPrice } from '../utils/tierPrice'
import { supabase } from '../lib/supabase'
import ProductGrid from '../components/store/ProductGrid'
import toast from 'react-hot-toast'
import { HIGHLIGHT_TOAST_STYLE } from '../utils/toastTheme'
import { BRAND_IMAGES } from '../hooks/useStorageImages'

const reviews = [
  {
    name: 'Chané Harris',
    rating: 5,
    text: 'Absolutely love this place! The vibe is unmatched and the products are always top quality. The staff are friendly and knowledgeable. 224 is truly a lifestyle experience.',
    date: 'via Google',
  },
  {
    name: 'Phathutshedzo Mutwanamba',
    rating: 5,
    text: 'Best lounge in Boksburg by far. Great atmosphere, premium selection and the community events are always fire. If you\'re not a member yet, what are you waiting for?',
    date: 'via Google',
  },
]

export default function Home() {
  const { data: products, isLoading, isError, refetch } = useProducts()
  const featuredProducts = products?.slice(0, 4)
  // Cheapest active tier for the membership band. While loading (or if the
  // read fails) the button simply says "Become a Member".
  const cheapestTier = useCheapestTier()
  const [newsletter, setNewsletter] = useState({ firstName: '', lastName: '', email: '' })
  const [subLoading, setSubLoading] = useState(false)

  useEffect(() => {
    document.title = '224 Clubhouse | Private Cannabis Lifestyle Lounge'
  }, [])

  const handleSubscribe = async (e) => {
    e.preventDefault()
    setSubLoading(true)
    // Normalised once, here, and used for BOTH calls. The subscribers table
    // stores emails lowercased, so "Sam@Example.com " subscribed fine and then
    // send-welcome-email looked the row up by the raw typed string and found
    // nothing — a silent no-welcome-email. Trim + lowercase keeps the two halves
    // talking about the same row.
    const email = newsletter.email.trim().toLowerCase()
    try {
      // Goes through the RPC rather than a direct insert so that someone who
      // previously unsubscribed can opt back in — a plain insert hit the
      // unique-email constraint and left them off the list permanently.
      const { error } = await supabase.rpc('subscribe_newsletter', {
        p_email: email,
        p_first_name: newsletter.firstName,
        p_last_name: newsletter.lastName,
      })
      if (error) throw error

      // The function reads the name and unsubscribe token from the row itself.
      await supabase.functions.invoke('send-welcome-email', {
        body: { email },
      })

      toast.success('Welcome to the 224 family! Check your email for your discount code.', {
        duration: 5000,
        style: HIGHLIGHT_TOAST_STYLE,
      })
      setNewsletter({ firstName: '', lastName: '', email: '' })
    } catch (err) {
      // 23505 is no longer reachable (the RPC upserts), but a stale cached
      // bundle could still hit the old path before it reloads.
      if (err.code === '23505') {
        toast.error('You\'re already subscribed!')
      } else {
        toast.error('Something went wrong. Please try again.')
      }
    } finally {
      setSubLoading(false)
    }
  }

  return (
    <div>
      {/* Hero — one phone screen tall (svh, so mobile browser bars don't crop it) */}
      <section className="relative min-h-svh flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0" aria-hidden="true">
          <img
            src={BRAND_IMAGES.header}
            alt=""
            fetchPriority="high"
            className="w-full h-full object-cover object-center"
          />
          {/* Dark wash so text stays readable, fading into the page below */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/65 to-background" />
          {/* Slow-drifting gold + leaf light */}
          <div className="absolute inset-0 hero-aura animate-drift" />
        </div>

        <div className="relative z-10 w-full max-w-4xl mx-auto px-5 pt-20 pb-16 text-center">
          <div className="animate-scaleIn">
            <div className="inline-flex flex-col items-center mb-6">
              <span className="font-heading text-7xl sm:text-8xl md:text-9xl font-bold text-gold leading-none tracking-wider">
                224
              </span>
              <span className="text-white text-xs md:text-sm tracking-[0.6em] uppercase font-light mt-2">
                Clubhouse
              </span>
            </div>

            <div className="w-24 h-px bg-gold mx-auto mb-6 md:mb-8" />

            <h1 className="font-heading text-3xl sm:text-4xl md:text-5xl font-semibold text-white mb-3 md:mb-4 tracking-wide">
              Premium. Private. Delivered.
            </h1>
            <p className="text-muted text-base md:text-lg max-w-xl mx-auto mb-8 md:mb-10 leading-relaxed">
              Order online and pay on delivery. We bring it to your door.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center">
              <Link to="/store" className="btn-gold w-full sm:w-auto px-8 py-4 text-sm uppercase tracking-widest">
                Shop Now <ArrowRight size={16} />
              </Link>
              <Link to="/membership" className="btn-outline w-full sm:w-auto px-8 py-4 text-sm uppercase tracking-widest">
                Join the Club
              </Link>
            </div>

            <p
              className="mt-6 inline-flex items-center gap-2 h-11 px-4 rounded-full border border-leaf/30 bg-leaf/10
                         text-white text-xs uppercase tracking-widest animate-glow-leaf"
            >
              <Truck size={14} className="text-leaf" />
              Free delivery for members
            </p>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2" aria-hidden="true">
          <div className="w-px h-10 bg-gradient-to-b from-gold/50 to-transparent motion-safe:animate-pulse" />
        </div>
      </section>

      {/* Category tiles — a swipeable row on phones, a 5-up grid on desktop */}
      <section className="py-14 md:py-24 max-w-7xl mx-auto">
        <div className="px-4 text-center mb-8 md:mb-14 reveal">
          <p className="text-gold text-xs uppercase tracking-[0.4em] mb-3">Browse</p>
          <h2 className="section-heading text-white">The Collection</h2>
        </div>

        <div className="flex gap-3 overflow-x-auto scrollbar-hide snap-x snap-mandatory scroll-px-4 px-4 pb-2
                        lg:grid lg:grid-cols-5 lg:gap-4 lg:overflow-visible">
          {CATEGORIES.map(({ value, title, icon: Icon, desc }) => (
            <Link
              key={value}
              to={`/store?category=${value}`}
              className="focus-ring group snap-start flex-shrink-0 w-40 lg:w-auto flex flex-col items-center text-center p-5
                         bg-surface border border-border rounded-xl transition-all duration-300
                         active:scale-95 hover:border-gold hover:shadow-glow"
            >
              <div className="bg-gold/10 group-hover:bg-leaf/15 p-4 rounded-full mb-3 transition-colors">
                <Icon size={24} className="text-gold group-hover:text-leaf transition-colors" />
              </div>
              <h3 className="text-white font-semibold text-sm mb-1">{title}</h3>
              <p className="text-muted text-xs leading-relaxed">{desc}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* Featured Products */}
      <section className="py-6 md:py-12 px-4 max-w-7xl mx-auto">
        <div className="flex items-end justify-between gap-4 mb-6 md:mb-10 reveal">
          <div>
            <p className="text-gold text-xs uppercase tracking-[0.4em] mb-3">Fresh Drop</p>
            <h2 className="section-heading text-white">From The Store</h2>
          </div>
          <Link
            to="/store"
            className="focus-ring rounded-lg flex-shrink-0 inline-flex items-center gap-1.5 h-11 text-gold text-xs sm:text-sm hover:text-gold-light transition-colors uppercase tracking-widest"
          >
            View All <ArrowRight size={14} />
          </Link>
        </div>
        {isError ? (
          <div className="bg-surface border border-red-500/20 rounded-2xl p-8 text-center max-w-md mx-auto">
            <AlertTriangle size={28} className="text-red-400 mx-auto mb-3" />
            <p className="text-white text-sm mb-5">
              Couldn't load products. Please check your connection and try again.
            </p>
            <button onClick={() => refetch()} className="btn-gold text-sm">
              Retry
            </button>
          </div>
        ) : (
          <ProductGrid products={featuredProducts} loading={isLoading} skeletonCount={4} />
        )}
      </section>

      {/* Membership band — the free-delivery pitch, with the live cheapest tier */}
      <section className="px-4 py-14 md:py-20">
        <div className="reveal relative overflow-hidden max-w-5xl mx-auto rounded-2xl border border-gold/20 bg-surface p-6 md:p-12">
          <div className="absolute inset-0 hero-aura animate-drift opacity-70" aria-hidden="true" />
          <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div>
              <p className="text-gold text-xs uppercase tracking-[0.4em] mb-3">Membership</p>
              <h2 className="font-heading text-2xl md:text-3xl font-bold text-white mb-4">Join the club</h2>
              <ul className="space-y-2.5 text-sm text-white/90">
                <li className="flex items-center gap-3">
                  <Truck size={16} className="text-leaf shrink-0" /> Free delivery on every order
                </li>
                <li className="flex items-center gap-3">
                  <Sparkles size={16} className="text-leaf shrink-0" /> Members-only products
                </li>
                <li className="flex items-center gap-3">
                  <Crown size={16} className="text-leaf shrink-0" /> Pay by EFT or with your next delivery
                </li>
              </ul>
            </div>
            <Link
              to="/membership"
              className="btn-gold w-full md:w-auto flex-shrink-0 px-8 py-4 text-sm uppercase tracking-widest"
            >
              {cheapestTier ? `Join from ${formatTierPrice(cheapestTier.price_cents)}` : 'Become a Member'}
              <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      {/* Reviews */}
      <section className="py-14 md:py-24 px-4 bg-surface border-y border-border">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-8 md:mb-14 reveal">
            <p className="text-gold text-xs uppercase tracking-[0.4em] mb-3">Community</p>
            <h2 className="section-heading text-white">What Members Say</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
            {reviews.map((review) => (
              <div
                key={review.name}
                className="bg-background border border-border rounded-xl p-6 md:p-8 reveal"
              >
                <div className="flex gap-1 mb-4">
                  {Array.from({ length: review.rating }).map((_, j) => (
                    <Star key={j} size={14} className="fill-gold text-gold" />
                  ))}
                </div>
                <p className="text-white/80 text-sm leading-relaxed mb-6 italic">"{review.text}"</p>
                <div className="flex items-center justify-between border-t border-border pt-4">
                  <div>
                    <p className="text-white font-semibold text-sm">{review.name}</p>
                    <p className="text-muted text-xs">{review.date}</p>
                  </div>
                  <div className="w-8 h-8 rounded-full bg-gold/10 flex items-center justify-center">
                    <span className="text-gold font-heading font-bold text-xs">{review.name[0]}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Gallery */}
      <section className="py-14 md:py-24 px-4 max-w-7xl mx-auto">
        <div className="text-center mb-8 md:mb-14 reveal">
          <p className="text-gold text-xs uppercase tracking-[0.4em] mb-3">The Experience</p>
          <h2 className="section-heading text-white">Life at 224</h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {BRAND_IMAGES.gallery.slice(0, 8).map((url, i) => (
            <div
              key={url}
              className={`overflow-hidden rounded-xl reveal ${i === 0 ? 'col-span-2 row-span-2' : ''}`}
            >
              <img
                src={url}
                alt={`224 Clubhouse gallery ${i + 1}`}
                loading="lazy"
                decoding="async"
                className="w-full h-full object-cover aspect-square hover:scale-105 transition-transform duration-500"
              />
            </div>
          ))}
        </div>
      </section>

      {/* Newsletter */}
      <section className="py-14 md:py-24 px-4">
        <div className="max-w-2xl mx-auto text-center">
          <div className="reveal bg-surface border border-border rounded-2xl p-6 sm:p-10 md:p-14">
            <div className="bg-gold/10 w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-6">
              <Mail size={24} className="text-gold" />
            </div>
            <p className="text-gold text-xs uppercase tracking-[0.4em] mb-3">Join The Fam</p>
            <h2 className="font-heading text-2xl md:text-3xl font-bold text-white mb-3">Never Miss a Beat</h2>
            <p className="text-muted text-sm mb-8 leading-relaxed">
              Subscribe for stock drops, events & updates.<br />
              <span className="text-gold font-semibold">Get 10% OFF</span> your first purchase.
            </p>

            <form onSubmit={handleSubscribe} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <input
                  className="input-base text-sm"
                  placeholder="First name"
                  autoComplete="given-name"
                  value={newsletter.firstName}
                  onChange={e => setNewsletter(n => ({ ...n, firstName: e.target.value }))}
                  required
                />
                <input
                  className="input-base text-sm"
                  placeholder="Last name"
                  autoComplete="family-name"
                  value={newsletter.lastName}
                  onChange={e => setNewsletter(n => ({ ...n, lastName: e.target.value }))}
                />
              </div>
              <input
                type="email"
                className="input-base text-sm"
                placeholder="your@email.com"
                autoComplete="email"
                value={newsletter.email}
                onChange={e => setNewsletter(n => ({ ...n, email: e.target.value }))}
                required
              />
              <button
                type="submit"
                disabled={subLoading}
                className="btn-gold w-full py-4 text-sm uppercase tracking-widest disabled:opacity-50"
              >
                {subLoading ? 'Subscribing...' : 'Subscribe & Get 10% Off'}
              </button>
            </form>
          </div>
        </div>
      </section>
    </div>
  )
}
