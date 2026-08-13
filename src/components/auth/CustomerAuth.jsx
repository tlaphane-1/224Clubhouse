import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Mail } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { validateNewPassword } from '../../utils/passwordValidation'
import ForgotPasswordForm from './ForgotPasswordForm'
import toast from 'react-hot-toast'

/**
 * Inline sign-in / create-account card for customers, shown wherever a page
 * needs an authenticated user (checkout, /orders). No navigation on success:
 * the parent re-renders once `user` is set by AuthContext.
 *
 * Email confirmation is required, so signup lands in a "pending" state until
 * the customer clicks the emailed link — which returns them to the page they
 * signed up from (redirectTo = current path) with their cart intact.
 */
export default function CustomerAuth({ title = 'Sign in to continue', subtitle }) {
  const { signIn, signUp, resendConfirmation } = useAuth()
  const location = useLocation()
  const redirectTo = window.location.origin + location.pathname

  const [mode, setMode] = useState('signin') // 'signin' | 'signup' | 'pending' | 'forgot'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [resendWait, setResendWait] = useState(false)

  const inputCls = 'input-base text-sm'
  const labelCls = 'block text-muted text-xs uppercase tracking-widest mb-1.5'

  const handleSignIn = async (e) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      await signIn(email.trim(), password)
      // Parent re-renders via AuthContext — nothing else to do here.
    } catch (err) {
      if (/email not confirmed/i.test(err?.message || '')) {
        setMode('pending')
      } else {
        toast.error(err?.message || 'Could not sign in. Please try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  const handleSignUp = async (e) => {
    e.preventDefault()
    if (busy) return
    const invalid = validateNewPassword(password, confirm)
    if (invalid) {
      toast.error(invalid)
      return
    }
    setBusy(true)
    try {
      const data = await signUp(email.trim(), password, { redirectTo })
      // Supabase obfuscates signups on an existing confirmed email: it
      // "succeeds" but returns a user with no identities.
      if (data?.user && (data.user.identities?.length ?? 0) === 0) {
        toast('An account with this email may already exist — try signing in.', { icon: 'ℹ️' })
        setMode('signin')
      } else {
        setMode('pending')
      }
    } catch (err) {
      toast.error(err?.message || 'Could not create your account. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const handleResend = async () => {
    if (resendWait) return
    try {
      await resendConfirmation(email.trim(), { redirectTo })
      toast.success('Confirmation email sent')
      setResendWait(true)
      setTimeout(() => setResendWait(false), 60000)
    } catch (err) {
      toast.error(err?.message || 'Could not resend the email. Please try again.')
    }
  }

  if (mode === 'forgot') {
    return (
      <div className="bg-surface border border-border rounded-xl p-6">
        <h2 className="font-semibold text-white mb-1 uppercase tracking-widest text-sm">
          Reset your password
        </h2>
        <p className="text-muted text-sm mb-5">
          Enter your account email and we&apos;ll send you a link to choose a new password.
        </p>
        <ForgotPasswordForm initialEmail={email} onBack={() => setMode('signin')} />
      </div>
    )
  }

  if (mode === 'pending') {
    return (
      <div className="bg-surface border border-border rounded-xl p-6 text-center">
        <Mail size={28} className="text-gold mx-auto mb-4" />
        <h2 className="font-semibold text-white mb-2 uppercase tracking-widest text-sm">
          Confirm your email
        </h2>
        <p className="text-muted text-sm leading-relaxed mb-6">
          We sent a confirmation link to{' '}
          <span className="text-white font-medium">{email.trim() || 'your inbox'}</span>.
          Click it and you'll come straight back here — your cart is safe.
        </p>
        <div className="space-y-3">
          <button
            type="button"
            onClick={handleResend}
            disabled={resendWait}
            className="btn-outline w-full py-3 text-xs uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {resendWait ? 'Email sent — wait a minute to resend' : 'Resend email'}
          </button>
          <button
            type="button"
            onClick={() => setMode('signin')}
            className="text-muted hover:text-white text-xs uppercase tracking-widest transition-colors"
          >
            Already confirmed? Sign in
          </button>
        </div>
      </div>
    )
  }

  const isSignup = mode === 'signup'

  return (
    <div className="bg-surface border border-border rounded-xl p-6">
      <h2 className="font-semibold text-white mb-1 uppercase tracking-widest text-sm">{title}</h2>
      {subtitle && <p className="text-muted text-sm mb-5">{subtitle}</p>}

      {/* Mode tabs */}
      <div className="grid grid-cols-2 gap-2 mb-6 mt-4">
        <button
          type="button"
          onClick={() => setMode('signin')}
          className={`py-2.5 text-xs uppercase tracking-widest rounded-lg border transition-colors ${
            !isSignup ? 'border-gold text-gold bg-gold/5' : 'border-border text-muted hover:text-white'
          }`}
        >
          Sign In
        </button>
        <button
          type="button"
          onClick={() => setMode('signup')}
          className={`py-2.5 text-xs uppercase tracking-widest rounded-lg border transition-colors ${
            isSignup ? 'border-gold text-gold bg-gold/5' : 'border-border text-muted hover:text-white'
          }`}
        >
          Create Account
        </button>
      </div>

      <form onSubmit={isSignup ? handleSignUp : handleSignIn} className="space-y-4">
        <div>
          <label className={labelCls}>Email Address</label>
          <input
            type="email"
            required
            className={inputCls}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com"
            autoComplete="email"
          />
        </div>
        <div>
          <label className={labelCls}>Password</label>
          <input
            type="password"
            required
            className={inputCls}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={isSignup ? 'At least 6 characters' : 'Your password'}
            autoComplete={isSignup ? 'new-password' : 'current-password'}
          />
          {!isSignup && (
            <div className="text-right mt-1.5">
              <button
                type="button"
                onClick={() => setMode('forgot')}
                className="text-muted hover:text-gold text-xs transition-colors"
              >
                Forgot password?
              </button>
            </div>
          )}
        </div>
        {isSignup && (
          <div>
            <label className={labelCls}>Confirm Password</label>
            <input
              type="password"
              required
              className={inputCls}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repeat your password"
              autoComplete="new-password"
            />
          </div>
        )}
        <button
          type="submit"
          disabled={busy}
          className="btn-gold w-full py-3 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? (isSignup ? 'Creating account…' : 'Signing in…') : isSignup ? 'Create Account' : 'Sign In'}
        </button>
      </form>
    </div>
  )
}
