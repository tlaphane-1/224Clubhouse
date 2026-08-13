import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import ForgotPasswordForm from '../components/auth/ForgotPasswordForm'
import toast from 'react-hot-toast'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [forgot, setForgot] = useState(false)
  const { signIn, isAdmin, user } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    document.title = 'Admin Login | 224 Clubhouse'
    if (user && isAdmin) navigate('/admin/dashboard')
  }, [user, isAdmin, navigate])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      await signIn(email, password)
      navigate('/admin/dashboard')
    } catch {
      toast.error('Invalid credentials', {
        style: { background: '#111111', color: '#fff', border: '1px solid #222222' },
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-background">
      <div
        className="w-full max-w-md animate-scaleIn"
      >
        <div className="bg-surface border border-border rounded-2xl p-10">
          {/* Logo */}
          <div className="text-center mb-8">
            <div className="font-heading text-5xl font-bold text-gold">224</div>
            <div className="text-white text-[9px] tracking-[0.5em] uppercase font-light mt-0.5">Admin Panel</div>
          </div>

          <h2 className="font-heading text-xl font-semibold text-white text-center mb-8">
            {forgot ? 'Reset Password' : 'Sign In'}
          </h2>

          {forgot ? (
            // Same recovery flow as customers: emails a link to /reset-password.
            <ForgotPasswordForm initialEmail={email} onBack={() => setForgot(false)} />
          ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-muted text-xs uppercase tracking-widest mb-1.5">Email</label>
              <input
                type="email"
                className="input-base"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="admin@224clubhouse.co.za"
                required
              />
            </div>
            <div>
              <label className="block text-muted text-xs uppercase tracking-widest mb-1.5">Password</label>
              <input
                type="password"
                className="input-base"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="btn-gold w-full py-4 mt-2 uppercase tracking-widest text-sm disabled:opacity-50"
            >
              {loading ? 'Signing In...' : 'Sign In'}
            </button>
            <div className="text-center pt-1">
              <button
                type="button"
                onClick={() => setForgot(true)}
                className="text-muted hover:text-gold text-xs transition-colors"
              >
                Forgot password?
              </button>
            </div>
          </form>
          )}
        </div>
      </div>
    </div>
  )
}
