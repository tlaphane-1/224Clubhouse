import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { LayoutDashboard, Package, ShoppingCart, Calendar, Crown, Mail, LogOut, Menu, X } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'

const navItems = [
  { to: '/admin/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/admin/products', icon: Package, label: 'Products' },
  { to: '/admin/orders', icon: ShoppingCart, label: 'Orders' },
  { to: '/admin/events', icon: Calendar, label: 'Events' },
  { to: '/admin/memberships', icon: Crown, label: 'Memberships' },
  { to: '/admin/messages', icon: Mail, label: 'Messages' },
]

export default function AdminLayout({ children }) {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)

  const handleSignOut = async () => {
    await signOut()
    navigate('/admin/login')
  }

  // Shared sidebar contents — rendered in both the desktop aside and the mobile drawer.
  const sidebar = (onNavigate) => (
    <>
      <div className="p-6 border-b border-border">
        <div className="font-heading text-3xl font-bold text-gold">224</div>
        <div className="text-white text-[9px] tracking-[0.4em] uppercase font-light mt-0.5">Admin Panel</div>
      </div>

      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            onClick={onNavigate}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all duration-200 ${
                isActive
                  ? 'bg-gold/10 text-gold border border-gold/20'
                  : 'text-muted hover:text-white hover:bg-border'
              }`
            }
          >
            <Icon size={18} />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="p-4 border-t border-border">
        <p className="text-muted text-xs truncate mb-3">{user?.email}</p>
        <button
          onClick={handleSignOut}
          className="flex items-center gap-2 text-muted hover:text-red-400 transition-colors text-sm w-full"
        >
          <LogOut size={16} />
          Sign Out
        </button>
      </div>
    </>
  )

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-64 bg-surface border-r border-border flex-col flex-shrink-0">
        {sidebar()}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="fixed top-0 left-0 bottom-0 z-[70] w-64 max-w-[80%] bg-surface border-r border-border flex flex-col lg:hidden">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute top-5 right-4 text-muted hover:text-white"
              aria-label="Close menu"
            >
              <X size={22} />
            </button>
            {sidebar(() => setMobileOpen(false))}
          </aside>
        </>
      )}

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <header className="lg:hidden sticky top-0 z-30 flex items-center justify-between bg-surface border-b border-border px-4 h-16">
          <div className="flex items-baseline gap-2">
            <span className="font-heading text-2xl font-bold text-gold">224</span>
            <span className="text-white text-[8px] tracking-[0.3em] uppercase font-light">Admin</span>
          </div>
          <button
            onClick={() => setMobileOpen(true)}
            className="text-muted hover:text-white p-2 -mr-2"
            aria-label="Open menu"
          >
            <Menu size={24} />
          </button>
        </header>

        <main className="flex-1 overflow-auto">
          <div className="p-4 sm:p-6 lg:p-8">{children}</div>
        </main>
      </div>
    </div>
  )
}
