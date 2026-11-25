import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { LogOut, LayoutGrid } from 'lucide-react'
import { useAuth } from '../../context/useAuth'
import { useMyOpenShift } from '../../hooks/useShifts'
import BrandLogo from '../../components/ui/BrandLogo'
import ShiftPanel from '../../components/counter/ShiftPanel'
import SalePanel from '../../components/counter/SalePanel'
import StockPanel from '../../components/counter/StockPanel'
import TodayPanel from '../../components/counter/TodayPanel'
import { pageTitle } from '../../tenant'

const TABS = [
  { id: 'sale', label: 'Sale' },
  { id: 'stock', label: 'Stock' },
  { id: 'today', label: 'Today' },
  { id: 'shift', label: 'Shift' },
]

// /counter — the shared counter tablet (staff accounts only, see StaffRoute).
// Sale: ring up in-store sales. Stock: stock-take. Today: live sales.
// Shift: selfie clock-in/out.
export default function Counter() {
  const { user, signOut } = useAuth()
  const shift = useMyOpenShift()
  const [tab, setTab] = useState(null)
  // Default: Sale when on shift, otherwise Shift (until the cashier picks a tab).
  const active = tab ?? (shift.data ? 'sale' : 'shift')

  useEffect(() => {
    document.title = pageTitle('Counter')
  }, [])

  return (
    <div className="min-h-screen bg-background px-4 py-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <BrandLogo className="h-10 w-auto" />
            <h1 className="font-heading text-xl text-white uppercase tracking-widest">Counter</h1>
          </div>
          <div className="flex items-center gap-1">
          <Link to="/table"
            className="focus-ring rounded-lg min-h-11 px-3 inline-flex items-center gap-2 text-muted hover:text-white text-xs uppercase tracking-widest">
            <LayoutGrid size={16} aria-hidden="true" /> Table mode
          </Link>
          <button
            type="button"
            onClick={signOut}
            className="focus-ring rounded-lg min-h-11 px-3 inline-flex items-center gap-2 text-muted hover:text-white text-xs uppercase tracking-widest"
            title={user?.email}
          >
            <LogOut size={16} aria-hidden="true" /> Sign out
          </button>
          </div>
        </header>

        <div role="tablist" aria-label="Counter" className="flex flex-wrap gap-2">
          {TABS.map(t => (
            <button key={t.id} type="button" role="tab" aria-selected={active === t.id} onClick={() => setTab(t.id)}
              className={`focus-ring min-h-11 px-5 rounded-xl text-xs uppercase tracking-widest border ${
                active === t.id ? 'border-gold text-gold bg-surface' : 'border-border text-muted hover:text-white'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {active === 'sale' && <SalePanel onShift={!!shift.data} onGoToShift={() => setTab('shift')} />}
        {active === 'stock' && <StockPanel onShift={!!shift.data} onGoToShift={() => setTab('shift')} />}
        {active === 'today' && <TodayPanel />}
        {active === 'shift' && <div className="max-w-lg"><ShiftPanel /></div>}
      </div>
    </div>
  )
}
