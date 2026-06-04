import { Link } from 'react-router-dom'
import { BRAND_IMAGES } from '../../hooks/useStorageImages'

function FacebookIcon({ size = 20, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>
    </svg>
  )
}

function InstagramIcon({ size = 20, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>
    </svg>
  )
}

export default function Footer() {
  return (
    <footer className="bg-surface border-t border-border mt-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
          {/* Brand */}
          <div>
            <img src={BRAND_IMAGES.logoWide} alt="224 Clubhouse" className="h-10 w-auto object-contain mb-4" />
            <p className="text-muted text-sm leading-relaxed max-w-xs">
              A private cannabis lifestyle lounge where good people and great energy meet. Members only. Elevated always.
            </p>
            <div className="flex gap-4 mt-6">
              <a
                href="https://www.facebook.com/224clubhouse"
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted hover:text-gold transition-colors"
                aria-label="Facebook"
              >
                <FacebookIcon size={20} />
              </a>
              <a
                href="https://www.instagram.com/224clubhouse"
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted hover:text-gold transition-colors"
                aria-label="Instagram"
              >
                <InstagramIcon size={20} />
              </a>
            </div>
          </div>

          {/* Quick Links */}
          <div>
            <h4 className="text-white font-semibold uppercase tracking-widest text-xs mb-6">
              Quick Links
            </h4>
            <ul className="space-y-3">
              {[
                { to: '/', label: 'Home' },
                { to: '/store', label: 'Shop' },
                { to: '/events', label: 'Events' },
                { to: '/membership', label: 'Membership' },
                { to: '/about', label: 'About Us' },
                { to: '/contact', label: 'Contact' },
              ].map(({ to, label }) => (
                <li key={label}>
                  <Link to={to} className="text-muted hover:text-gold text-sm transition-colors">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Hours & Address */}
          <div>
            <h4 className="text-white font-semibold uppercase tracking-widest text-xs mb-6">
              Visit Us
            </h4>
            <div className="space-y-4">
              <div>
                <p className="text-gold text-xs uppercase tracking-widest mb-1.5">Hours</p>
                <p className="text-white text-sm">Monday – Sunday</p>
                <p className="text-muted text-sm">09:00 – 19:00 (Including Holidays)</p>
              </div>
              <div>
                <p className="text-gold text-xs uppercase tracking-widest mb-1.5">Address</p>
                <address className="text-muted text-sm not-italic leading-relaxed">
                  224 Rondebult Ave<br />
                  Libradene, Boksburg<br />
                  1459
                </address>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-border flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-muted text-xs">
            © {new Date().getFullYear()} 224 Clubhouse. All rights reserved.
          </p>
          <p className="text-muted text-xs text-center">
            🔞 No sales to persons under 21 years of age. Not for sale to minors.
          </p>
        </div>
      </div>
    </footer>
  )
}
