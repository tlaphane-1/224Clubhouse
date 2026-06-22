import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Leaf, Candy, Wrench, ShoppingBag, Star, Mail } from 'lucide-react'
import { useProducts } from '../hooks/useProducts'
import { supabase } from '../lib/supabase'
import ProductGrid from '../components/store/ProductGrid'
import toast from 'react-hot-toast'
import { BRAND_IMAGES } from '../hooks/useStorageImages'

const categories = [
  { value: 'flower', label: 'Flower Selections', icon: Leaf, desc: 'Premium cannabis flower, handpicked' },
  { value: 'edibles', label: 'Edibles', icon: Candy, desc: 'Infused treats & beverages' },
  { value: 'accessories', label: 'Accessories', icon: Wrench, desc: 'Gear for the discerning smoker' },
  { value: 'merchandise', label: 'Merchandise', icon: ShoppingBag, desc: 'Represent the culture' },
]

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
  const { data: products, isLoading } = useProducts()
  const featuredProducts = products?.slice(0, 4)
  const [newsletter, setNewsletter] = useState({ firstName: '', lastName: '', email: '' })
  const [subLoading, setSubLoading] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    document.title = '224 Clubhouse | Private Cannabis Lifestyle Lounge'
  }, [])

  const handleSubscribe = async (e) => {
    e.preventDefault()
    setSubLoading(true)
    try {
      const { error } = await supabase.from('newsletter_subscribers').insert({
        email: newsletter.email,
        first_name: newsletter.firstName,
        last_name: newsletter.lastName,
      })
      if (error) throw error

      await supabase.functions.invoke('send-welcome-email', {
        body: { firstName: newsletter.firstName, email: newsletter.email },
      })

      toast.success('Welcome to the 224 family! Check your email for your discount code.', {
        duration: 5000,
        style: { background: '#111111', color: '#fff', border: '1px solid #C9A84C' },
      })
      setNewsletter({ firstName: '', lastName: '', email: '' })
    } catch (err) {
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
      {/* Hero */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
        {/* Background — real header photo */}
        <div className="absolute inset-0">
          <img
            src={BRAND_IMAGES.header}
            alt=""
            className="w-full h-full object-cover object-center"
          />
          {/* Dark overlay so text stays readable */}
          <div className="absolute inset-0 bg-black/70" />
          {/* Gold radial glow */}
          <div className="absolute inset-0"
            style={{ background: 'radial-gradient(ellipse at center, rgba(201,168,76,0.12) 0%, transparent 65%)' }} />
        </div>

        <div className="relative z-10 text-center px-6 max-w-4xl mx-auto">
          <div className="animate-scaleIn">
            <div className="inline-block mb-6">
              <div className="font-heading text-[clamp(5rem,15vw,10rem)] font-bold text-gold leading-none tracking-wider">
                224
              </div>
              <div className="text-white text-[clamp(0.6rem,1.5vw,0.85rem)] tracking-[0.6em] uppercase font-light -mt-2">
                Clubhouse
              </div>
            </div>

            <div className="w-24 h-px bg-gold mx-auto mb-8" />

            <h1 className="font-heading text-[clamp(1.5rem,4vw,2.5rem)] font-semibold text-white mb-4 tracking-wide">
              Private Lifestyle Lounge
            </h1>
            <p className="text-muted text-lg max-w-xl mx-auto mb-10 leading-relaxed">
              Where good people & great energy meet.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link to="/store" className="btn-gold px-8 py-4 text-sm uppercase tracking-widest flex items-center gap-2">
                Shop Now <ArrowRight size={16} />
              </Link>
              <Link to="/membership" className="btn-outline px-8 py-4 text-sm uppercase tracking-widest">
                Become a Member
              </Link>
            </div>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2">
          <div className="w-px h-12 bg-gradient-to-b from-gold/50 to-transparent animate-pulse" />
        </div>
      </section>

      {/* Category Grid */}
      <section className="py-24 px-4 max-w-7xl mx-auto">
        <div className="text-center mb-14 animate-fadeIn">
          <p className="text-gold text-xs uppercase tracking-[0.4em] mb-3">Browse</p>
          <h2 className="section-heading text-white">The Collection</h2>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {categories.map(({ value, label, icon: Icon, desc }) => (
            <div
              key={value}
              className="animate-fadeIn"
            >
              <Link
                to={`/store?category=${value}`}
                className="group flex flex-col items-center text-center p-6 bg-surface border border-border
                           rounded-xl transition-all duration-300 hover:border-gold hover:shadow-xl hover:shadow-gold/10"
              >
                <div className="bg-gold/10 group-hover:bg-gold/20 p-4 rounded-full mb-4 transition-colors">
                  <Icon size={24} className="text-gold" />
                </div>
                <h3 className="text-white font-semibold text-sm mb-1.5">{label}</h3>
                <p className="text-muted text-xs leading-relaxed">{desc}</p>
                <div className="mt-4 text-gold text-xs uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                  Explore <ArrowRight size={10} />
                </div>
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* Featured Products */}
      <section className="py-12 px-4 max-w-7xl mx-auto">
        <div className="flex items-end justify-between mb-10">
          <div>
            <p className="text-gold text-xs uppercase tracking-[0.4em] mb-3">Fresh Drop</p>
            <h2 className="section-heading text-white">From The Store</h2>
          </div>
          <Link to="/store" className="text-gold text-sm hover:text-gold-light transition-colors flex items-center gap-1.5 uppercase tracking-widest">
            View All <ArrowRight size={14} />
          </Link>
        </div>
        <ProductGrid products={featuredProducts} loading={isLoading} />
      </section>

      {/* Reviews */}
      <section className="py-24 px-4 bg-surface border-y border-border">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-gold text-xs uppercase tracking-[0.4em] mb-3">Community</p>
            <h2 className="section-heading text-white">What Members Say</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {reviews.map((review) => (
              <div
                key={review.name}
                className="bg-background border border-border rounded-xl p-8 animate-fadeIn"
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
      <section className="py-24 px-4 max-w-7xl mx-auto">
        <div className="text-center mb-14">
          <p className="text-gold text-xs uppercase tracking-[0.4em] mb-3">The Experience</p>
          <h2 className="section-heading text-white">Life at 224</h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {BRAND_IMAGES.gallery.slice(0, 8).map((url, i) => (
            <div
              key={url}
              className={`overflow-hidden rounded-xl animate-fade ${i === 0 ? 'col-span-2 row-span-2' : ''}`}
            >
              <img
                src={url}
                alt={`224 Clubhouse gallery ${i + 1}`}
                className="w-full h-full object-cover aspect-square hover:scale-105 transition-transform duration-500"
              />
            </div>
          ))}
        </div>
      </section>

      {/* Newsletter */}
      <section className="py-24 px-4">
        <div className="max-w-2xl mx-auto text-center">
          <div className="bg-surface border border-border rounded-2xl p-10 md:p-14">
            <div className="bg-gold/10 w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-6">
              <Mail size={24} className="text-gold" />
            </div>
            <p className="text-gold text-xs uppercase tracking-[0.4em] mb-3">Join The Fam</p>
            <h2 className="font-heading text-3xl font-bold text-white mb-3">Never Miss a Beat</h2>
            <p className="text-muted text-sm mb-8 leading-relaxed">
              Subscribe for stock drops, events & updates.<br />
              <span className="text-gold font-semibold">Get 10% OFF</span> your first purchase.
            </p>

            <form onSubmit={handleSubscribe} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <input
                  className="input-base text-sm"
                  placeholder="First name"
                  value={newsletter.firstName}
                  onChange={e => setNewsletter(n => ({ ...n, firstName: e.target.value }))}
                  required
                />
                <input
                  className="input-base text-sm"
                  placeholder="Last name"
                  value={newsletter.lastName}
                  onChange={e => setNewsletter(n => ({ ...n, lastName: e.target.value }))}
                />
              </div>
              <input
                type="email"
                className="input-base text-sm"
                placeholder="your@email.com"
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
