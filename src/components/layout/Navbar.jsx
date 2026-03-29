import { useState, useEffect } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ShoppingBag, Menu, X } from 'lucide-react'
import { useCart } from '../../context/CartContext'

const navLinks = [
  { to: '/', label: 'Home' },
  { to: '/store', label: 'Store' },
  { to: '/events', label: 'Events' },
]

export default function Navbar() {
  const { cartCount } = useCart()
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

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
            <Link to="/" className="flex flex-col leading-none group">
              <span className="font-heading text-4xl font-bold text-gold tracking-wider group-hover:text-gold-light transition-colors">
                224
              </span>
              <span className="text-white text-[9px] tracking-[0.5em] uppercase font-light -mt-1">
                Clubhouse
              </span>
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

            {/* Cart + Mobile Menu */}
            <div className="flex items-center gap-4">
              <Link to="/cart" className="relative group">
                <ShoppingBag
                  size={22}
                  className={`transition-colors duration-200 ${
                    cartCount > 0 ? 'text-gold' : 'text-muted group-hover:text-white'
                  }`}
                />
                <AnimatePresence>
                  {cartCount > 0 && (
                    <motion.span
                      key="badge"
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      exit={{ scale: 0 }}
                      className="absolute -top-2 -right-2 bg-gold text-black text-[10px] font-bold
                                 w-5 h-5 rounded-full flex items-center justify-center"
                    >
                      {cartCount > 99 ? '99+' : cartCount}
                    </motion.span>
                  )}
                </AnimatePresence>
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
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm"
              onClick={() => setMobileOpen(false)}
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'tween', duration: 0.3 }}
              className="fixed top-0 right-0 bottom-0 z-[70] w-72 bg-surface border-l border-border flex flex-col"
            >
              <div className="flex items-center justify-between p-6 border-b border-border">
                <span className="font-heading text-2xl font-bold text-gold">224</span>
                <button onClick={() => setMobileOpen(false)} className="text-muted hover:text-white">
                  <X size={24} />
                </button>
              </div>

              <nav className="flex-1 p-6 flex flex-col gap-6">
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
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
