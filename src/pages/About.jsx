import { Fragment, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { BRAND_IMAGES } from '../hooks/useStorageImages'
import { tenant, pageTitle } from '../tenant'

const { heroLines, heroIntro, founderHeading, founderParagraphs, timeline, values, cta } = tenant.content.about

export default function About() {
  useEffect(() => { document.title = pageTitle('About Us') }, [])

  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <section className="relative pt-32 pb-24 px-4 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_60%_50%,theme(colors.gold/0.06)_0%,transparent_60%)]" />
        <div className="max-w-4xl mx-auto relative z-10">
          <div className="animate-fadeIn">
            <p className="text-gold text-xs uppercase tracking-[0.4em] mb-3">Our Story</p>
            <h1 className="font-heading text-5xl md:text-6xl font-bold text-white mb-6 leading-tight">
              {heroLines.map((line, i) => (
                <Fragment key={line}>
                  {i > 0 && <br />}
                  {line}
                </Fragment>
              ))}
            </h1>
            <div className="w-16 h-px bg-gold mb-8" />
            <p className="text-muted text-lg leading-relaxed max-w-2xl">
              {heroIntro}
            </p>
          </div>
        </div>
      </section>

      {/* Founder Story */}
      <section className="py-20 px-4 bg-surface border-y border-border">
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
          <div className="animate-fadeIn">
            <p className="text-gold text-xs uppercase tracking-[0.4em] mb-3">The Founder</p>
            <h2 className="section-heading text-white mb-6">{founderHeading}</h2>
            <div className="space-y-4 text-muted leading-relaxed">
              {founderParagraphs.map(paragraph => (
                <p key={paragraph}>
                  {paragraph}
                </p>
              ))}
            </div>
          </div>
          <div
            className="relative animate-fadeIn"
          >
            <img
              src={BRAND_IMAGES.header}
              alt={tenant.name}
              className="w-full aspect-square object-cover rounded-2xl"
            />
            <div className="absolute inset-0 rounded-2xl ring-1 ring-gold/20" />
          </div>
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
              {timeline.map((item) => (
                <div
                  key={item.year}
                  className="flex gap-8 items-start animate-fadeIn"
                >
                  <div className="w-32 shrink-0 text-right">
                    <span className="font-heading text-2xl font-bold text-gold">{item.year}</span>
                  </div>
                  <div className="relative">
                    <div className="absolute -left-[2.15rem] top-2 w-3 h-3 rounded-full bg-gold border-2 border-background" />
                    <h3 className="font-heading text-lg font-bold text-white mb-2">{item.title}</h3>
                    <p className="text-muted text-sm leading-relaxed">{item.description}</p>
                  </div>
                </div>
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
            {values.map((v) => (
              <div
                key={v.title}
                className="bg-background border border-border rounded-xl p-8 animate-fadeIn"
              >
                <h3 className="font-heading text-xl font-bold text-gold mb-3">{v.title}</h3>
                <p className="text-muted text-sm leading-relaxed">{v.desc}</p>
              </div>
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
          <h2 className="font-heading text-3xl font-bold text-white mb-4">{cta.heading}</h2>
          <p className="text-muted mb-8">{cta.text}</p>
          <Link to="/membership" className="btn-gold px-10 py-4 text-sm uppercase tracking-widest inline-flex items-center gap-2">
            View Membership Options <ArrowRight size={16} />
          </Link>
        </div>
      </section>
    </div>
  )
}
