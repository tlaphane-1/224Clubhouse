import { useEffect } from 'react'

/**
 * Shared shell for the legal/compliance pages (Privacy, Terms,
 * Delivery & Returns). Mirrors the About/Contact page conventions:
 * dark background, gold eyebrow + heading, narrow readable prose column.
 */

export const LAST_UPDATED = '13 August 2026'

/** Removable once management has signed off on the wording. */
export function DraftBanner() {
  return (
    <div className="bg-gold/10 border border-gold/40 rounded-xl px-5 py-4 mb-10">
      <p className="text-gold text-sm font-semibold">
        Draft — under review by 224 Clubhouse management
      </p>
      <p className="text-muted text-xs mt-1 leading-relaxed">
        This document has not yet been finalised. Please contact us if anything here is unclear.
      </p>
    </div>
  )
}

/** A note for statements management still needs to confirm. */
export function ReviewNote({ children }) {
  return (
    <p className="text-gold/80 text-xs italic mt-2 leading-relaxed">
      [To be confirmed by management: {children}]
    </p>
  )
}

export function LegalSection({ title, children }) {
  return (
    <section className="mb-10">
      <h2 className="font-heading text-xl font-bold text-gold mb-4">{title}</h2>
      <div className="space-y-4 text-muted text-sm leading-relaxed">{children}</div>
    </section>
  )
}

export default function LegalPage({ eyebrow, title, intro, children }) {
  useEffect(() => { document.title = `${title} | 224 Clubhouse` }, [title])

  return (
    <div className="min-h-screen bg-background">
      <section className="pt-32 pb-12 px-4">
        <div className="max-w-3xl mx-auto animate-fadeIn">
          <p className="text-gold text-xs uppercase tracking-[0.4em] mb-3">{eyebrow}</p>
          <h1 className="font-heading text-4xl md:text-5xl font-bold text-white mb-4">{title}</h1>
          <div className="w-16 h-px bg-gold mb-6" />
          {intro && <p className="text-muted leading-relaxed">{intro}</p>}
        </div>
      </section>

      <section className="pb-20 px-4">
        <div className="max-w-3xl mx-auto">
          <DraftBanner />
          {children}
          <p className="text-muted text-xs pt-6 border-t border-border">
            Last updated: {LAST_UPDATED}
          </p>
        </div>
      </section>
    </div>
  )
}
