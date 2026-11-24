import { useEffect } from 'react'
import { LogOut } from 'lucide-react'
import { useAuth } from '../../context/useAuth'
import BrandLogo from '../../components/ui/BrandLogo'
import ShiftPanel from '../../components/counter/ShiftPanel'
import { pageTitle } from '../../tenant'

// /counter — the shared counter tablet (staff accounts only, see StaffRoute).
// Part 1: shift clock-in. Sales, stock and the live dashboard come next.
export default function Counter() {
  const { user, signOut } = useAuth()

  useEffect(() => {
    document.title = pageTitle('Counter')
  }, [])

  return (
    <div className="min-h-screen bg-background px-4 py-6">
      <div className="max-w-lg mx-auto space-y-6">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <BrandLogo className="h-10 w-auto" />
            <h1 className="font-heading text-xl text-white uppercase tracking-widest">Counter</h1>
          </div>
          <button
            type="button"
            onClick={signOut}
            className="focus-ring rounded-lg min-h-11 px-3 inline-flex items-center gap-2 text-muted hover:text-white text-xs uppercase tracking-widest"
            title={user?.email}
          >
            <LogOut size={16} aria-hidden="true" /> Sign out
          </button>
        </header>
        <ShiftPanel />
        <p className="text-muted text-xs text-center">Sales, stock-take and the live dashboard arrive in the next update.</p>
      </div>
    </div>
  )
}
