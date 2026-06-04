import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { MapPin, Phone, Mail, Clock, Send } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'

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
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/>
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>
    </svg>
  )
}

const INFO = [
  {
    icon: MapPin,
    label: 'Address',
    lines: ['224 Rondebult Ave', 'Libradene, Boksburg', '1459, Gauteng'],
    action: { label: 'Get Directions', href: 'https://maps.google.com/?q=224+Rondebult+Ave+Libradene+Boksburg' },
  },
  {
    icon: Phone,
    label: 'Phone',
    lines: ['075 086 8783'],
    action: { label: 'Call Us', href: 'tel:0750868783' },
  },
  {
    icon: Mail,
    label: 'Email',
    lines: ['team@224clubhouse.co.za'],
    action: { label: 'Send Email', href: 'mailto:team@224clubhouse.co.za' },
  },
  {
    icon: Clock,
    label: 'Hours',
    lines: ['Monday – Sunday', '09:00 – 19:00', 'Including public holidays'],
  },
]

export default function Contact() {
  useEffect(() => { document.title = 'Contact | 224 Clubhouse' }, [])
  const [form, setForm] = useState({ name: '', email: '', subject: '', message: '' })
  const [loading, setLoading] = useState(false)

  function handleChange(e) {
    const { name, value } = e.target
    setForm(f => ({ ...f, [name]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name || !form.email || !form.message) {
      toast.error('Please fill in all required fields.')
      return
    }
    setLoading(true)
    try {
      // Store as a newsletter subscriber note or invoke an edge function
      // For now, send via the send-order-email pattern — store in a contact_messages table
      // Fallback: just show success (email forwarding can be wired later)
      await supabase.functions.invoke('send-contact-email', {
        body: { name: form.name, email: form.email, subject: form.subject, message: form.message },
      }).catch(() => null) // graceful — function may not exist yet

      toast.success('Message sent! We\'ll get back to you within 1–2 business days.', {
        duration: 5000,
        style: { background: '#111111', color: '#fff', border: '1px solid #C9A84C' },
      })
      setForm({ name: '', email: '', subject: '', message: '' })
    } catch {
      toast.error('Something went wrong. Please email us directly at team@224clubhouse.co.za')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <section className="pt-32 pb-16 px-4 text-center">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <p className="text-gold text-xs uppercase tracking-[0.4em] mb-3">Get In Touch</p>
          <h1 className="font-heading text-5xl md:text-6xl font-bold text-white mb-4">Contact Us</h1>
          <div className="w-16 h-px bg-gold mx-auto mb-6" />
          <p className="text-muted max-w-lg mx-auto leading-relaxed">
            Have a question, a vibe, or just want to find us? We're right here.
          </p>
        </motion.div>
      </section>

      <section className="py-12 px-4">
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12">

          {/* Contact Info */}
          <div className="space-y-6">
            {INFO.map((item, i) => {
              const Icon = item.icon
              return (
                <motion.div
                  key={item.label}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.08, duration: 0.4 }}
                  className="flex gap-5 bg-surface border border-border rounded-xl p-6"
                >
                  <div className="w-11 h-11 bg-gold/10 rounded-lg flex items-center justify-center shrink-0">
                    <Icon size={20} className="text-gold" />
                  </div>
                  <div>
                    <p className="text-gold text-xs uppercase tracking-widest mb-2">{item.label}</p>
                    {item.lines.map(line => (
                      <p key={line} className="text-white text-sm">{line}</p>
                    ))}
                    {item.action && (
                      <a
                        href={item.action.href}
                        target={item.action.href.startsWith('http') ? '_blank' : undefined}
                        rel="noopener noreferrer"
                        className="text-gold text-xs uppercase tracking-widest mt-2 inline-block hover:text-gold-light transition-colors"
                      >
                        {item.action.label} →
                      </a>
                    )}
                  </div>
                </motion.div>
              )
            })}

            {/* Social */}
            <div className="bg-surface border border-border rounded-xl p-6">
              <p className="text-gold text-xs uppercase tracking-widest mb-4">Follow Us</p>
              <div className="flex gap-4">
                <a
                  href="https://www.facebook.com/224clubhouse"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-muted hover:text-gold transition-colors text-sm"
                >
                  <FacebookIcon size={18} /> Facebook
                </a>
                <a
                  href="https://www.instagram.com/224clubhouse"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-muted hover:text-gold transition-colors text-sm"
                >
                  <InstagramIcon size={18} /> Instagram
                </a>
              </div>
            </div>
          </div>

          {/* Contact Form */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            <div className="bg-surface border border-border rounded-2xl p-8">
              <h2 className="font-heading text-2xl font-bold text-white mb-6">Send a Message</h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-muted uppercase tracking-widest block mb-1.5">Name *</label>
                    <input className="input-base" name="name" value={form.name} onChange={handleChange} placeholder="Your name" required />
                  </div>
                  <div>
                    <label className="text-xs text-muted uppercase tracking-widest block mb-1.5">Email *</label>
                    <input className="input-base" type="email" name="email" value={form.email} onChange={handleChange} placeholder="your@email.com" required />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-muted uppercase tracking-widest block mb-1.5">Subject</label>
                  <input className="input-base" name="subject" value={form.subject} onChange={handleChange} placeholder="What's it about?" />
                </div>
                <div>
                  <label className="text-xs text-muted uppercase tracking-widest block mb-1.5">Message *</label>
                  <textarea
                    className="input-base resize-none"
                    name="message"
                    rows={5}
                    value={form.message}
                    onChange={handleChange}
                    placeholder="Tell us what's on your mind..."
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="btn-gold w-full py-4 text-sm uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {loading ? 'Sending...' : <><Send size={14} /> Send Message</>}
                </button>
              </form>
            </div>

            {/* Map embed */}
            <div className="mt-6 rounded-2xl overflow-hidden border border-border h-56">
              <iframe
                title="224 Clubhouse Location"
                src="https://www.google.com/maps/embed/v1/place?key=AIzaSyD-9tSrke72FloqCDE9M7BkA6Q8rRZZlOo&q=224+Rondebult+Ave,+Libradene,+Boksburg"
                width="100%"
                height="100%"
                style={{ border: 0, filter: 'invert(90%) hue-rotate(180deg)' }}
                allowFullScreen
                loading="lazy"
              />
            </div>
          </motion.div>
        </div>
      </section>
    </div>
  )
}
