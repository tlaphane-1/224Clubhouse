import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { KeyRound, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../context/AuthContext'
import { validateNewPassword, MIN_PASSWORD_LENGTH } from '../utils/passwordValidation'

/**
 * Landing page for the password-recovery email (customers and admins).
 *
 * Recovery-session detection: the emailed link uses Supabase's default
 * implicit flow, so it arrives here with tokens in the URL hash. supabase-js
 * (detectSessionInUrl, on by default) exchanges them for a session during
 * client initialisation — and getSession() awaits that — so by the time
 * AuthContext finishes loading, `session` already reflects the recovery
 * session (the client also fires the PASSWORD_RECOVERY auth event, which
 * AuthContext's onAuthStateChange listener absorbs like any sign-in). That
 * means this page only needs `loading` + `session` from useAuth: session →
 * show the new-password form; no session → the link was expired/used/invalid
 * or the visit was direct.
 *
 * NOTE: the Supabase project's Auth redirect allowlist must include the site
 * origin for the email link to land here (configured in the dashboard).
 */
export default function ResetPassword() {
  const { session, loading, updatePassword } = useAuth()
  const navigate = useNavigate()

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    document.title = 'Reset Password | 224 Clubhouse'
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (busy) return
    const invalid = validateNewPassword(password, confirm)
    if (invalid) {
      toast.error(invalid)
      return
    }
    setBusy(true)
    try {
      await updatePassword(password)
      toast.success('Password updated — you are signed in')
      navigate('/orders')
    } catch (err) {
      toast.error(err?.message || 'Could not update your password. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const labelCls = 'block text-muted text-xs uppercase tracking-widest mb-1.5'

  return (
    <div className="min-h-screen pt-28 pb-20 animate-fadeIn">
      <div className="max-w-md mx-auto px-4">
        <div className="mb-10">
          <p className="text-gold text-xs uppercase tracking-[0.3em] mb-3">Account</p>
          <h1 className="font-heading text-3xl md:text-4xl font-bold text-white">Reset Password</h1>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
          </div>
        ) : session ? (
          <div className="bg-surface border border-border rounded-xl p-6">
            <div className="flex items-center gap-3 mb-5">
              <KeyRound size={20} className="text-gold shrink-0" />
              <p className="text-muted text-sm">
                Choose a new password
                {session.user?.email && (
                  <>
                    {' '}for <span className="text-white font-medium">{session.user.email}</span>
                  </>
                )}
                .
              </p>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className={labelCls}>New Password</label>
                <input
                  type="password"
                  required
                  className="input-base text-sm"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                  autoComplete="new-password"
                />
              </div>
              <div>
                <label className={labelCls}>Confirm New Password</label>
                <input
                  type="password"
                  required
                  className="input-base text-sm"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Repeat your new password"
                  autoComplete="new-password"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="btn-gold w-full py-3 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {busy ? 'Updating…' : 'Update Password'}
              </button>
            </form>
          </div>
        ) : (
          <div className="bg-surface border border-border rounded-xl p-6 text-center">
            <AlertTriangle size={28} className="text-gold mx-auto mb-4" />
            <h2 className="font-semibold text-white mb-2 uppercase tracking-widest text-sm">
              Reset link invalid or expired
            </h2>
            <p className="text-muted text-sm leading-relaxed mb-6">
              This page only works right after following the link in a password-reset
              email, and each link works once. Request a fresh one from the sign-in
              form and try again.
            </p>
            <Link
              to="/orders"
              className="btn-outline inline-block px-6 py-3 text-xs uppercase tracking-widest"
            >
              Go to sign in
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
