import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { BRAND_IMAGES } from '../hooks/useStorageImages'

const timeline = [
  {
    year: '2021',
    title: 'Dank Monkey',
    description: 'George opens his first cannabis retail space in the East Rand, driven by a passion for the plant and a belief in its healing potential. The community responds immediately.',
  },
  {
    year: '2022',
    title: 'Herbally',
    description: 'Rebranding to Herbally, the focus shifts toward education, wellness, and building a more intentional community around cannabis culture in South Africa.',
  },
  {
    year: '2025',
    title: '224 Clubhouse',
    description: 'April 2025. The culmination of years of experience and community building — 224 Clubhouse opens its doors as a private, members-based lifestyle lounge at 224 Rondebult Ave, Boksburg.',
  },
]

const values = [
  { title: 'Community', desc: 'We are built on people. Every member, every session, every event strengthens the foundation of what 224 represents.' },
  { title: 'Authenticity', desc: 'No pretence. We are exactly what we say we are — a space for real people who love the culture and live with intention.' },
  { title: 'Wellness', desc: 'The plant has always been about healing. We honour that by promoting responsible, informed, and intentional consumption.' },
  { title: 'Excellence', desc: 'From the products we carry to the experience we create — average is not an option. Everything at 224 is curated with care.' },
]

export default function About() {
  useEffect(() => { document.title = 'About Us | 224 Clubhouse' }, [])

  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <section className="relative pt-32 pb-24 px-4 overflow-hidden">
        <div className="absolute inset-0"
          style={{ background: 'radial-gradient(ellipse at 60% 50%, rgba(201,168,76,0.06) 0%, transparent 60%)' }} />
        <div className="max-w-4xl mx-auto relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <p className="text-gold text-xs uppercase tracking-[0.4em] mb-3">Our Story</p>
            <h1 className="font-heading text-5xl md:text-6xl font-bold text-white mb-6 leading-tight">
              Built on Experience,<br />Authenticity & Love<br />for the Culture.
            </h1>
            <div className="w-16 h-px bg-gold mb-8" />
            <p className="text-muted text-lg leading-relaxed max-w-2xl">
              224 Clubhouse represents the evolution of cannabis culture in South Africa — a space where community, connection, and intentional living converge.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Founder Story */}
      <section className="py-20 px-4 bg-surface border-y border-border">
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5 }}
          >
            <p className="text-gold text-xs uppercase tracking-[0.4em] mb-3">The Founder</p>
            <h2 className="section-heading text-white mb-6">George's Story</h2>
            <div className="space-y-4 text-muted leading-relaxed">
              <p>
                George's relationship with cannabis isn't just professional — it's deeply personal. Watching his father use the plant to manage PTSD planted a seed that never stopped growing. He saw firsthand what responsible, intentional cannabis use could do for someone's quality of life.
              </p>
              <p>
                That experience became the foundation of everything he would build. Not just a retail space, but a community. A place where the stigma falls away and the culture is celebrated for what it truly is — healing, creativity, connection.
              </p>
              <p>
                From Dank Monkey in 2021 to Herbally in 2022, each iteration brought him closer to the vision that would become 224 Clubhouse. In April 2025, that vision became reality at 224 Rondebult Ave, Boksburg — the address that gave the clubhouse its name.
              </p>
            </div>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="relative"
          >
            <img
              src={BRAND_IMAGES.header}
              alt="224 Clubhouse"
              className="w-full aspect-square object-cover rounded-2xl"
            />
            <div className="absolute inset-0 rounded-2xl ring-1 ring-gold/20" />
          </motion.div>
        </div>
      </section>

      {/* Timeline */}
      <section className="py-20 px-4">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-gold text-xs uppercase tracking-[0.4em] mb-3">The Journey</p>
            <h2 className="section-heading text-white">How We Got Here</h2>
          </div>
          <div className="relative">
            <div className="absolute left-16 top-0 bottom-0 w-px bg-border" />
            <div className="space-y-10">
              {timeline.map((item, i) => (
                <motion.div
                  key={item.year}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.15, duration: 0.4 }}
                  className="flex gap-8 items-start"
                >
                  <div className="w-32 shrink-0 text-right">
                    <span className="font-heading text-2xl font-bold text-gold">{item.year}</span>
                  </div>
                  <div className="relative">
                    <div className="absolute -left-[2.15rem] top-2 w-3 h-3 rounded-full bg-gold border-2 border-background" />
                    <h3 className="font-heading text-lg font-bold text-white mb-2">{item.title}</h3>
                    <p className="text-muted text-sm leading-relaxed">{item.description}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="py-20 px-4 bg-surface border-y border-border">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-gold text-xs uppercase tracking-[0.4em] mb-3">What Drives Us</p>
            <h2 className="section-heading text-white">Our Values</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {values.map((v, i) => (
              <motion.div
                key={v.title}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1, duration: 0.4 }}
                className="bg-background border border-border rounded-xl p-8"
              >
                <h3 className="font-heading text-xl font-bold text-gold mb-3">{v.title}</h3>
                <p className="text-muted text-sm leading-relaxed">{v.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Gallery strip */}
      <section className="py-20 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
            {BRAND_IMAGES.gallery.slice(0, 5).map((url, i) => (
              <div key={i} className="overflow-hidden rounded-xl aspect-square">
                <img src={url} alt="" className="w-full h-full object-cover hover:scale-105 transition-transform duration-500" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-4 text-center">
        <div className="max-w-xl mx-auto">
          <h2 className="font-heading text-3xl font-bold text-white mb-4">Ready to Join the Family?</h2>
          <p className="text-muted mb-8">Become a member and be part of something real.</p>
          <Link to="/membership" className="btn-gold px-10 py-4 text-sm uppercase tracking-widest inline-flex items-center gap-2">
            View Membership Options <ArrowRight size={16} />
          </Link>
        </div>
      </section>
    </div>
  )
}
