import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { LogOut, Package, Search, BadgeCheck, ChevronRight } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useMyMembership } from '../hooks/useMyMembership'
import CustomerAuth from '../components/auth/CustomerAuth'

const STATUS_STYLES = {
  active: 'bg-gold/10 text-gold border-gold/30',
  pending: 'bg-surface text-muted border-border',
  expired: 'bg-surface text-red-400 border-red-500/20',
}

// Turn a tier slug like "gold-member" into "Gold Member" for display.
function tierLabel(tier) {
  if (!tier) return 'Member'
  return tier
    .split(/[-_\s]+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

const accountLinks = [
  { to: '/orders', label: 'My Orders', icon: Package, note: 'Orders placed on this account' },
  { to: '/track', label: 'Track an Order', icon: Search, note: 'Find any order by number and email' },
  { to: '/membership', label: 'Membership', icon: BadgeCheck, note: 'Tiers, perks and your application' },
]

export default function Account() {
  const { user, loading: authLoading, signOut } = useAuth()
  // `latest` (not `current`) so a lapsed membership still shows as expired
  // instead of falling through to the "you're not a member yet" pitch.
  const { latest, effectiveStatus, isLoading: membershipLoading } = useMyMembership()

  useEffect(() => {
    document.title = 'My Account | 224 Clubhouse'
  }, [])

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen pt-28 pb-20 animate-fadeIn">
      <div className="max-w-2xl mx-auto px-4">
        <div className="mb-10">
          <p className="text-gold text-xs uppercase tracking-[0.3em] mb-3">Your Account</p>
          <h1 className="font-heading text-3xl md:text-4xl font-bold text-white">My Account</h1>
          {!user && (
            <p className="text-muted text-sm mt-3">
              Sign in to see your orders, membership and account details in one place.
            </p>
          )}
        </div>

        {!user ? (
          <CustomerAuth
            title="Sign in to your account"
            subtitle="Your orders and membership are saved to your account, so you can manage them from any device."
          />
        ) : (
          <div className="space-y-6">
            {/* Identity card */}
            <div className="bg-surface border border-border rounded-2xl p-4 flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-muted text-xs uppercase tracking-widest mb-0.5">Signed in as</p>
                <p className="text-white text-sm truncate">{user.email}</p>
              </div>
              <button
                type="button"
                onClick={signOut}
                className="btn-outline px-4 py-2 text-xs uppercase tracking-widest inline-flex items-center gap-2"
              >
                <LogOut size={14} />
                Sign Out
              </button>
            </div>

            {/* Membership card */}
            <div className="bg-surface border border-border rounded-2xl p-6">
              <h2 className="text-white font-semibold text-sm uppercase tracking-widest mb-4">
                Membership
              </h2>
              {membershipLoading ? (
                <div className="flex justify-center py-4">
                  <div className="w-6 h-6 border-2 border-gold border-t-transparent rounded-full animate-spin" />
                </div>
              ) : latest ? (
                <>
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <p className={`font-heading text-lg font-bold ${
                        effectiveStatus === 'expired' ? 'text-white' : 'text-gold'
                      }`}>
                        {tierLabel(latest.tier)}
                      </p>
                      <p className="text-muted text-xs mt-1">
                        {effectiveStatus === 'pending' && 'Application received — awaiting approval.'}
                        {effectiveStatus === 'active' && latest.expires_at &&
                          `Active until ${new Date(latest.expires_at).toLocaleDateString('en-ZA')}`}
                        {effectiveStatus === 'active' && !latest.expires_at && 'Active'}
                        {effectiveStatus === 'expired' && (latest.expires_at
                          ? `Your membership expired on ${new Date(latest.expires_at).toLocaleDateString('en-ZA')}.`
                          : 'Your membership has expired.')}
                      </p>
                    </div>
                    <span
                      className={`text-[10px] uppercase tracking-widest border rounded-full px-3 py-1 ${
                        STATUS_STYLES[effectiveStatus] ?? STATUS_STYLES.pending
                      }`}
                    >
                      {effectiveStatus}
                    </span>
                  </div>
                  {effectiveStatus === 'expired' && (
                    <Link
                      to="/membership"
                      className="btn-gold w-full mt-5 py-3 text-xs uppercase tracking-widest inline-block text-center"
                    >
                      Renew Membership
                    </Link>
                  )}
                </>
              ) : (
                <div className="text-center py-2">
                  <p className="text-white text-sm mb-1">You're not a member yet</p>
                  <p className="text-muted text-xs mb-5">
                    Unlock lounge access, member pricing and event perks.
                  </p>
                  <Link to="/membership" className="btn-gold px-6 py-3 text-xs uppercase tracking-widest">
                    Become a Member
                  </Link>
                </div>
              )}
            </div>

            {/* Quick links */}
            <div className="bg-surface border border-border rounded-2xl p-2">
              {accountLinks.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className="flex items-center gap-4 p-4 rounded-xl hover:bg-background transition-colors group"
                >
                  <item.icon size={18} className="text-gold shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-white text-sm">{item.label}</p>
                    <p className="text-muted text-xs mt-0.5">{item.note}</p>
                  </div>
                  <ChevronRight size={16} className="text-muted group-hover:text-white transition-colors" />
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
