import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export function useMemberships() {
  return useQuery({
    queryKey: ['memberships'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('memberships')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })
}

// Status changes go through the admin_update_membership_status RPC — a bare
// table update would skip the approval bookkeeping the migration owns
// (approved_at/starts_at/expires_at stamping on activation, status_history
// append on every transition).
//
// Variables may carry an optional `member` object ({ name, email, tierName },
// supplied by the admin page from the row being acted on) so the confirmation
// email can be sent on approval without a second fetch.
export function useUpdateMembershipStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, status }) => {
      const { data, error } = await supabase.rpc('admin_update_membership_status', {
        p_id: id,
        p_status: status,
      })
      if (error) throw error
      return data
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['memberships'] })

      // Confirmation email — fire and forget. The membership is already active;
      // if Resend is misconfigured or slow the admin's approval must still land,
      // so this never blocks the flow and never surfaces an error to them.
      // Only the membership id goes over the wire: the function verifies the
      // caller is an admin and reads recipient, name, tier and the freshly
      // stamped expires_at from the row, so no caller can aim a branded email
      // at an address of their choosing.
      if (variables.status === 'active') {
        supabase.functions
          .invoke('send-membership-email', {
            body: { membershipId: variables.id },
          })
          .catch(() => {
            /* the membership stands with or without the email */
          })
      }
    },
  })
}

// Walk-in members (cash at the door, no account) — created directly as
// active with the clock started, via the admin_create_membership RPC.
export function useAdminCreateMembership() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ customer, tierSlug }) => {
      const { data, error } = await supabase.rpc('admin_create_membership', {
        p_customer: customer,
        p_tier_slug: tierSlug,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['memberships'] }),
  })
}

// Attaches a walk-in membership (user_id null) to the account that member
// later signed up with, so owner-select RLS and the member-only checkout gate
// recognise them. Without this a paid walk-in member is told "members only".
export function useLinkMembershipUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, email }) => {
      const { data, error } = await supabase.rpc('admin_link_membership_user', {
        p_membership_id: id,
        p_email: email,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['memberships'] }),
  })
}

// Admin tier list: the permissive membership_tiers_admin_all policy lets
// admins select INACTIVE tiers too (public select only sees active ones).
export function useAllMembershipTiers() {
  return useQuery({
    queryKey: ['membership-tiers', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('membership_tiers')
        .select('*')
        .order('sort_order', { ascending: true })
      if (error) throw error
      return data
    },
  })
}

// Tier writes are direct table access — membership_tiers_admin_all RLS
// covers insert/update for admins. Invalidating the ['membership-tiers']
// prefix also refreshes the customer-facing tier queries.
export function useCreateMembershipTier() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload) => {
      const { error } = await supabase.from('membership_tiers').insert(payload)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['membership-tiers'] }),
  })
}

export function useUpdateMembershipTier() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, payload }) => {
      const { error } = await supabase.from('membership_tiers').update(payload).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['membership-tiers'] }),
  })
}
