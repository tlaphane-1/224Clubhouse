import { useState, useEffect, useRef } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { ShoppingBag, Menu, X, User, LogOut, Package, LayoutDashboard, ChevronDown } from 'lucide-react'
import { useCart } from '../../context/CartContext'
import { useAuth } from '../../context/AuthContext'
import { BRAND_IMAGES } from '../../hooks/useStorageImages'

const baseLinks = [
  { to: '/', label: 'Home' },
  { to: '/store', label: 'Store' },
  { to: '/events', label: 'Events' },
  { to: '/membership', label: 'Membership' },
  { to: '/about', label: 'About' },
]

// Anonymous visitors still need Track Order in the main nav; signed-in
// customers reach their orders through the account menu instead.
const trackLink = { to: '/track', label: 'Track Order' }

export default function Navbar() {
  const { cartCount } = useCart()
  const { user, isAdmin, signOut } = useAuth()
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const accountRef = useRef(null)

  const navLinks = user ? baseLinks : [...baseLinks, trackLink]
  const emailName = user?.email?.split('@')[0] ?? ''

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Close the account dropdown on any outside click.
  useEffect(() => {
    if (!accountOpen) return
    const onClick = (e) => {
      if (accountRef.current && !accountRef.current.contains(e.target)) {
        setAccountOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [accountOpen])

  const handleSignOut = async () => {
    setAccountOpen(false)
    setMobileOpen(false)
    await signOut()
  }

  const accountMenuItems = [
    { to: '/account', label: 'My Account', icon: User },
    { to: '/orders', label: 'My Orders', icon: Package },
    ...(isAdmin ? [{ to: '/admin/dashboard', label: 'Admin Dashboard', icon: LayoutDashboard }] : []),
  ]

  return (
    <>
      <nav
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          scrolled ? 'bg-background/95 backdrop-blur-md border-b border-border shadow-lg shadow-black/20' : 'bg-transparent'
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-20">
            {/* Logo */}
            <Link to="/" className="flex items-center group">
              <img
                src={BRAND_IMAGES.logoWide}
                alt="224 Clubhouse"
                className="h-10 w-auto object-contain brightness-100 group-hover:brightness-110 transition-all"
              />
            </Link>

            {/* Desktop Nav */}
            <div className="hidden md:flex items-center gap-8">
              {navLinks.map(({ to, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/'}
                  className={({ isActive }) =>
                    `text-sm tracking-widest uppercase font-medium transition-colors duration-200 ${
                      isActive ? 'text-gold' : 'text-muted hover:text-white'
                    }`
                  }
                >
                  {label}
                </NavLink>
              ))}
            </div>

            {/* Account + Cart + Mobile Menu */}
            <div className="flex items-center gap-4">
              {/* Account area (desktop) */}
              {user ? (
                <div className="relative hidden md:block" ref={accountRef}>
                  <button
                    type="button"
                    onClick={() => setAccountOpen((v) => !v)}
                    className={`flex items-center gap-2 text-sm transition-colors duration-200 ${
                      accountOpen ? 'text-gold' : 'text-muted hover:text-white'
                    }`}
                  >
                    <User size={18} />
                    <span className="max-w-[120px] truncate uppercase tracking-widest text-xs font-medium">
                      {emailName}
                    </span>
                    <ChevronDown
                      size={14}
                      className={`transition-transform duration-200 ${accountOpen ? 'rotate-180' : ''}`}
                    />
                  </button>

                  {accountOpen && (
                    <div className="absolute right-0 top-full mt-3 w-56 bg-surface border border-border rounded-xl shadow-lg shadow-black/40 py-2 animate-fade">
                      <p className="px-4 py-2 text-muted text-xs truncate border-b border-border mb-1">
                        {user.email}
                      </p>
                      {accountMenuItems.map((item) => (
                        <Link
                          key={item.to}
                          to={item.to}
                          onClick={() => setAccountOpen(false)}
                          className="flex items-center gap-3 px-4 py-2.5 text-sm text-muted hover:text-white hover:bg-background transition-colors"
                        >
                          <item.icon size={15} className="text-gold" />
                          {item.label}
                        </Link>
                      ))}
                      <button
                        type="button"
                        onClick={handleSignOut}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-muted hover:text-white hover:bg-background transition-colors"
                      >
                        <LogOut size={15} className="text-gold" />
                        Sign Out
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <Link
                  to="/account"
                  className="hidden md:flex items-center gap-2 text-xs uppercase tracking-widest font-medium text-muted hover:text-white transition-colors duration-200"
                >
                  <User size={18} />
                  Sign In
                </Link>
              )}

              <Link to="/cart" className="relative group">
                <ShoppingBag
                  size={22}
                  className={`transition-colors duration-200 ${
                    cartCount > 0 ? 'text-gold' : 'text-muted group-hover:text-white'
                  }`}
                />
                {cartCount > 0 && (
                  <span
                    className="absolute -top-2 -right-2 bg-gold text-black text-[10px] font-bold
                               w-5 h-5 rounded-full flex items-center justify-center animate-scaleIn"
                  >
                    {cartCount > 99 ? '99+' : cartCount}
                  </span>
                )}
              </Link>

              <button
                className="md:hidden text-muted hover:text-white transition-colors"
                onClick={() => setMobileOpen(true)}
              >
                <Menu size={24} />
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <>
            <div
              className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm animate-fade"
              onClick={() => setMobileOpen(false)}
            />
            <div
              className="fixed top-0 right-0 bottom-0 z-[70] w-72 bg-surface border-l border-border flex flex-col animate-slideInRight"
            >
              <div className="flex items-center justify-between p-6 border-b border-border">
                <img src={BRAND_IMAGES.logoWide} alt="224 Clubhouse" className="h-8 w-auto object-contain" />
                <button onClick={() => setMobileOpen(false)} className="text-muted hover:text-white">
                  <X size={24} />
                </button>
              </div>

              <nav className="flex-1 p-6 flex flex-col gap-6 overflow-y-auto">
                {navLinks.map(({ to, label }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === '/'}
                    onClick={() => setMobileOpen(false)}
                    className={({ isActive }) =>
                      `text-lg tracking-widest uppercase font-medium transition-colors ${
                        isActive ? 'text-gold' : 'text-white hover:text-gold'
                      }`
                    }
                  >
                    {label}
                  </NavLink>
                ))}

                {/* Account section */}
                <div className="border-t border-border pt-6 flex flex-col gap-6">
                  {user ? (
                    <>
                      <p className="text-muted text-xs truncate -mb-2">{user.email}</p>
                      {accountMenuItems.map(({ to, label }) => (
                        <NavLink
                          key={to}
                          to={to}
                          onClick={() => setMobileOpen(false)}
                          className={({ isActive }) =>
                            `text-lg tracking-widest uppercase font-medium transition-colors ${
                              isActive ? 'text-gold' : 'text-white hover:text-gold'
                            }`
                          }
                        >
                          {label}
                        </NavLink>
                      ))}
                      <button
                        type="button"
                        onClick={handleSignOut}
                        className="text-left text-lg tracking-widest uppercase font-medium text-white hover:text-gold transition-colors"
                      >
                        Sign Out
                      </button>
                    </>
                  ) : (
                    <NavLink
                      to="/account"
                      onClick={() => setMobileOpen(false)}
                      className={({ isActive }) =>
                        `text-lg tracking-widest uppercase font-medium transition-colors ${
                          isActive ? 'text-gold' : 'text-white hover:text-gold'
                        }`
                      }
                    >
                      Sign In
                    </NavLink>
                  )}
                </div>
              </nav>

              <div className="p-6 border-t border-border">
                <Link
                  to="/cart"
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center gap-3 text-muted hover:text-white transition-colors"
                >
                  <ShoppingBag size={20} />
                  <span className="text-sm uppercase tracking-widest">Cart</span>
                  {cartCount > 0 && (
                    <span className="ml-auto bg-gold text-black text-xs font-bold px-2 py-0.5 rounded-full">
                      {cartCount}
                    </span>
                  )}
                </Link>
              </div>
            </div>
          </>
        )}
    </>
  )
}
