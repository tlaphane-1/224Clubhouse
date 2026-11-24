import { useAuth } from '../../context/useAuth'
import CustomerAuth from '../auth/CustomerAuth'

// The counter tablet signs in as a staff account (never an admin's). The real
// gate is the server: every counter/shift RPC checks is_staff().
export default function StaffRoute({ children }) {
  const { user, loading, isStaff } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background" role="status" aria-label="Loading">
        <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background px-4 py-10">
        <div className="max-w-lg mx-auto">
          <CustomerAuth title="Staff sign in" subtitle="Sign in with the staff account the owner set up for you." />
        </div>
      </div>
    )
  }

  if (!isStaff) {
    return (
      <div className="min-h-screen bg-background px-4 py-10">
        <div className="max-w-lg mx-auto bg-surface border border-border rounded-2xl p-6 text-center">
          <h1 className="font-heading text-xl text-white mb-2">Not set up as staff</h1>
          <p className="text-muted text-sm">
            This account isn&apos;t set up as staff. Ask the owner to add you in Admin → Staff.
          </p>
        </div>
      </div>
    )
  }

  return children
}
