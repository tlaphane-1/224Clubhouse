import { NavLink, useNavigate } from 'react-router-dom'
import { LayoutDashboard, Package, ShoppingCart, Calendar, LogOut } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'

const navItems = [
  { to: '/admin/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/admin/products', icon: Package, label: 'Products' },
  { to: '/admin/orders', icon: ShoppingCart, label: 'Orders' },
  { to: '/admin/events', icon: Calendar, label: 'Events' },
]

export default function AdminLayout({ children }) {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    await signOut()
    navigate('/admin/login')
  }

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-64 bg-surface border-r border-border flex flex-col flex-shrink-0">
        <div className="p-6 border-b border-border">
          <div className="font-heading text-3xl font-bold text-gold">224</div>
          <div className="text-white text-[9px] tracking-[0.4em] uppercase font-light mt-0.5">Admin Panel</div>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
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
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        <div className="p-8">{children}</div>
      </main>
    </div>
  )
}
