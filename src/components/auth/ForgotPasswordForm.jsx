import { useState } from 'react'
import { Mail } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import toast from 'react-hot-toast'

/**
 * Email → reset-link form shared by CustomerAuth (customers) and the admin
 * Login page. Parents supply their own card/heading; this renders only the
 * form and its "sent" state. Repeat sends are throttled 60s, matching the
 * resend-confirmation pattern in CustomerAuth.
 *
 * The emailed link lands on /reset-password (see AuthContext.resetPassword),
 * which works for customers and admins alike.
 */
export default function ForgotPasswordForm({ initialEmail = '', onBack, backLabel = 'Back to sign in' }) {
  const { resetPassword } = useAuth()
  const [email, setEmail] = useState(initialEmail)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [resendWait, setResendWait] = useState(false)

  const send = async () => {
    await resetPassword(email.trim())
    setResendWait(true)
    setTimeout(() => setResendWait(false), 60000)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (busy || resendWait) return
    setBusy(true)
    try {
      await send()
      setSent(true)
    } catch (err) {
      toast.error(err?.message || 'Could not send the reset email. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const handleResend = async () => {
    if (busy || resendWait) return
    setBusy(true)
    try {
      await send()
      toast.success('Reset email sent')
    } catch (err) {
      toast.error(err?.message || 'Could not resend the email. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <div className="text-center">
        <Mail size={28} className="text-gold mx-auto mb-4" />
        <h3 className="font-semibold text-white mb-2 uppercase tracking-widest text-sm">
          Check your email
        </h3>
        <p className="text-muted text-sm leading-relaxed mb-6">
          If an account exists for{' '}
          <span className="text-white font-medium">{email.trim() || 'that address'}</span>,
          we sent it a reset link. Click it to choose a new password.
        </p>
        <div className="space-y-3">
          <button
            type="button"
            onClick={handleResend}
            disabled={busy || resendWait}
            className="btn-outline w-full py-3 text-xs uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {resendWait ? 'Email sent — wait a minute to resend' : 'Resend email'}
          </button>
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="text-muted hover:text-white text-xs uppercase tracking-widest transition-colors"
            >
              {backLabel}
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-muted text-xs uppercase tracking-widest mb-1.5">
          Email Address
        </label>
        <input
          type="email"
          required
          className="input-base text-sm"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@email.com"
          autoComplete="email"
        />
      </div>
      <button
        type="submit"
        disabled={busy || resendWait}
        className="btn-gold w-full py-3 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {busy ? 'Sending…' : 'Send reset link'}
      </button>
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="block mx-auto text-muted hover:text-white text-xs uppercase tracking-widest transition-colors"
        >
          {backLabel}
        </button>
      )}
    </form>
  )
}
