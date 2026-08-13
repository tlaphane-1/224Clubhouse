import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

/**
 * Client-side mirror of the SQL membership_effective_status() computed
 * column: an 'active' membership past its expires_at reads as 'expired'.
 * Every other status passes through unchanged.
 */
export function membershipEffectiveStatus(m) {
  if (!m) return null
  if (m.status === 'active' && m.expires_at && new Date(m.expires_at) < new Date()) {
    return 'expired'
  }
  return m.status
}

/**
 * The signed-in customer's own memberships, newest first.
 *
 * The `memberships_owner_select` RLS policy already limits reads to the
 * caller's rows, but the explicit user_id filter is still required: RLS
 * policies OR together, so an admin (who passes the admin select policy)
 * would otherwise see every membership here — same defensive convention
 * as useMyOrders.
 *
 * Returns the query plus:
 * - `memberships`: all rows (empty array while loading / signed out)
 * - `current`: the live one — first row that is 'pending', or 'active'
 *   with expires_at still in the future (mirrors the place_membership
 *   dedupe check, so `current == null` means the user may apply)
 * - `latest`: the row worth *showing* — `current` when there is one, else
 *   the most recent lapsed/'expired' row. Keeps `current` strict for the
 *   may-apply check while letting the UI say "expired on X" instead of
 *   pitching a lapsed member as if they had never joined.
 * - `effectiveStatus`: membershipEffectiveStatus(latest) — reads 'expired'
 *   for a lapsed member (unreachable while it derived from `current`).
 *   Still null when there is nothing to show, and still only 'active' when
 *   the membership is genuinely live, so member-pricing checks are unchanged.
 */
export function useMyMembership() {
  const { user } = useAuth()
  const query = useQuery({
    queryKey: ['my-membership', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('memberships')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
    enabled: !!user,
  })

  const memberships = query.data ?? []
  const current =
    memberships.find(
      m =>
        m.status === 'pending' ||
        (m.status === 'active' && (!m.expires_at || new Date(m.expires_at) > new Date())),
    ) ?? null

  // Rows come back newest first. 'cancelled' rows are skipped — there is
  // nothing useful to show a customer for an application that was withdrawn.
  const latest =
    current ??
    memberships.find(m => m.status === 'active' || m.status === 'expired') ??
    null

  return {
    ...query,
    memberships,
    current,
    latest,
    effectiveStatus: membershipEffectiveStatus(latest),
  }
}
