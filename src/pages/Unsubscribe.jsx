import { useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { MailCheck, MailX, AlertTriangle } from 'lucide-react'
import { useNewsletterUnsubscribe } from '../hooks/useNewsletterSubscribers'
import { useStopCartReminders } from '../hooks/useSavedCart'
import BrandLogo from '../components/ui/BrandLogo'

// The token is a uuid straight from the DB. Checking the shape here means a
// mangled link (truncated by a mail client, or someone poking at the URL)
// shows the friendly "link isn't valid" state instead of a Postgres
// "invalid input syntax for type uuid" error.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function Shell({ icon, title, children }) {
  return (
    <div className="min-h-screen bg-background pt-32 pb-20 px-4 animate-fadeIn">
      <div className="max-w-md mx-auto text-center">
        {/* Wordmark */}
        <BrandLogo className="h-12 mx-auto mb-10" />

        <div className="bg-surface border border-border rounded-xl p-8">
          <div className="flex justify-center mb-5">{icon}</div>
          <h1 className="font-heading text-2xl font-bold text-white mb-3">{title}</h1>
          <div className="w-12 h-px bg-gold mx-auto mb-5" />
          {children}
        </div>

        <Link to="/" className="btn-outline text-sm inline-block mt-8">
          Back to 224 Clubhouse
        </Link>
      </div>
    </div>
  )
}

// Two kinds of link land here: newsletter (?token=) and abandoned-cart
// reminders (?cart=, from send-cart-reminders).
export default function Unsubscribe() {
  const [searchParams] = useSearchParams()
  if (searchParams.has('cart')) return <CartRemindersOptOut raw={searchParams.get('cart') || ''} />
  return <NewsletterUnsubscribe raw={searchParams.get('token') || ''} />
}

function CartRemindersOptOut({ raw }) {
  const token = UUID_RE.test(raw.trim()) ? raw.trim() : null
  const { data, isLoading, isError, refetch } = useStopCartReminders(token)

  useEffect(() => {
    document.title = 'Cart reminders | 224 Clubhouse'
  }, [])

  if (!token || (!isLoading && !isError && data === false)) {
    return (
      <Shell icon={<AlertTriangle size={32} className="text-gold" />} title="This link isn't valid">
        <p className="text-muted text-sm leading-relaxed">
          We couldn't match this link. Try opening it again from the original email, or email{' '}
          <a href="mailto:224clubhouse@gmail.com" className="text-gold underline underline-offset-2">
            224clubhouse@gmail.com
          </a>{' '}
          and we'll switch cart reminders off for you.
        </p>
      </Shell>
    )
  }

  if (isLoading) {
    return (
      <Shell icon={<MailX size={32} className="text-muted" />} title="Updating…">
        <p className="text-muted text-sm">One moment while we update your preferences.</p>
      </Shell>
    )
  }

  if (isError) {
    return (
      <Shell icon={<AlertTriangle size={32} className="text-red-400" />} title="Something went wrong">
        <p className="text-muted text-sm leading-relaxed mb-6">
          We couldn't update your preferences just now. Please try again — reminders are still on.
        </p>
        <button onClick={() => refetch()} className="btn-gold text-sm">
          Try again
        </button>
      </Shell>
    )
  }

  return (
    <Shell icon={<MailCheck size={32} className="text-gold" />} title="Cart reminders are off">
      <p className="text-muted text-sm leading-relaxed">
        We won't email you about items left in your cart again. You'll still get emails about
        orders and memberships you place.
      </p>
    </Shell>
  )
}

function NewsletterUnsubscribe({ raw: rawToken }) {
  const raw = rawToken.trim()
  const token = UUID_RE.test(raw) ? raw : null

  const { data, isLoading, isError, refetch } = useNewsletterUnsubscribe(token)

  useEffect(() => {
    document.title = 'Unsubscribe | 224 Clubhouse'
  }, [])

  // Malformed or missing token — never hit the network for this.
  if (!token) {
    return (
      <Shell icon={<AlertTriangle size={32} className="text-gold" />} title="This link isn't valid">
        <p className="text-muted text-sm leading-relaxed">
          The unsubscribe link looks incomplete. Some email apps cut long links in half — try
          opening it again from the original email, or email us at{' '}
          <a href="mailto:224clubhouse@gmail.com" className="text-gold hover:underline">
            224clubhouse@gmail.com
          </a>{' '}
          and we'll remove you.
        </p>
      </Shell>
    )
  }

  if (isLoading) {
    return (
      <Shell icon={<MailX size={32} className="text-muted" />} title="Unsubscribing…">
        <p className="text-muted text-sm">One moment while we update your preferences.</p>
      </Shell>
    )
  }

  // Network / server failure — the customer isn't unsubscribed yet, so say so.
  if (isError) {
    return (
      <Shell icon={<AlertTriangle size={32} className="text-red-400" />} title="Something went wrong">
        <p className="text-muted text-sm leading-relaxed mb-6">
          We couldn't update your preferences just now. Please try again — you have not been
          unsubscribed yet.
        </p>
        <button onClick={() => refetch()} className="btn-gold text-sm">
          Try again
        </button>
      </Shell>
    )
  }

  // Token isn't on the list (already deleted, or simply wrong).
  if (!data?.success) {
    return (
      <Shell icon={<AlertTriangle size={32} className="text-gold" />} title="This link isn't valid">
        <p className="text-muted text-sm leading-relaxed">
          We couldn't match this link to a subscription. It may already have been removed. If you
          are still receiving our newsletter, email{' '}
          <a href="mailto:224clubhouse@gmail.com" className="text-gold hover:underline">
            224clubhouse@gmail.com
          </a>{' '}
          and we'll take you off the list.
        </p>
      </Shell>
    )
  }

  return (
    <Shell icon={<MailCheck size={32} className="text-gold" />} title="You've been unsubscribed">
      <p className="text-muted text-sm leading-relaxed">
        {data.email ? (
          <>
            <span className="text-white break-all">{data.email}</span> has been removed from the
            224 Clubhouse newsletter. You won't receive further newsletters from us.
          </>
        ) : (
          <>You have been removed from the 224 Clubhouse newsletter and won't receive further
            newsletters from us.</>
        )}
      </p>
      <p className="text-muted text-xs leading-relaxed mt-4">
        You'll still get transactional emails about orders or memberships you place. Changed your
        mind? Sign up again on the{' '}
        <Link to="/" className="text-gold hover:underline">home page</Link> — you'll be added
        straight back.
      </p>
    </Shell>
  )
}
