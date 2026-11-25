import { useState } from 'react'
import { Lock } from 'lucide-react'
import { useAuth } from '../../context/useAuth'
import { unlockTable } from '../../utils/tableLock'

// Leaving table mode: the staff account's password, so a customer at the
// table can't reach the counter (sales, customer search, stock).
export default function StaffUnlock({ onUnlocked, onCancel }) {
  const { user, signIn } = useAuth()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await signIn(user.email, password)
      unlockTable()
      onUnlocked()
    } catch {
      setError('That password is not right.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="max-w-sm mx-auto bg-surface border border-border rounded-2xl p-6 space-y-4">
      <div className="flex items-center gap-2 text-white font-semibold">
        <Lock size={18} className="text-gold" aria-hidden="true" /> Staff only
      </div>
      <p className="text-muted text-sm">Enter the staff password to leave table mode.</p>
      <div>
        <label htmlFor="staff-unlock" className="block text-muted text-xs uppercase tracking-widest mb-1.5">Password</label>
        <input id="staff-unlock" type="password" className="input-base text-sm" value={password}
          onChange={e => setPassword(e.target.value)} autoComplete="current-password"
          aria-invalid={error ? true : undefined} aria-describedby={error ? 'staff-unlock-error' : undefined} />
        {error && <p id="staff-unlock-error" className="text-red-400 text-sm mt-1" role="alert">{error}</p>}
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={busy || !password} className="btn-gold flex-1 min-h-11">{busy ? 'Checking…' : 'Unlock'}</button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="btn-outline min-h-11 px-4 text-xs uppercase tracking-widest">Back</button>
        )}
      </div>
    </form>
  )
}
