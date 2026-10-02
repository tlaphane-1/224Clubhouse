import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

/**
 * Admin-only subscriber list. RLS (newsletter_admin_select) makes this return
 * nothing for anyone who isn't in admin_users.
 *
 * Rows include `unsubscribed_at` (NULL = still subscribed). Unsubscribed
 * people are KEPT in the table as proof of the opt-out — filtering them out is
 * the consumer's job, and the CSV export must never include them.
 */
export function useNewsletterSubscribers() {
  return useQuery({
    queryKey: ['newsletter-subscribers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('newsletter_subscribers')
        .select('*')
        .order('subscribed_at', { ascending: false })
      if (error) throw error
      return data
    },
  })
}

/** A subscriber still on the mailing list. */
export function isActiveSubscriber(subscriber) {
  return !subscriber?.unsubscribed_at
}

/**
 * One-click unsubscribe for the `/unsubscribe?token=…` link in every campaign.
 *
 * Calls the SECURITY DEFINER `unsubscribe_newsletter` RPC — the token is the
 * only credential, so this works logged out (the normal case: the link is
 * clicked from an email client). The RPC is idempotent, which is why running
 * it as a query on mount is safe; retries and refetches are still disabled so
 * a customer sees one clear outcome.
 *
 * Resolves to `{ success: true, email }` or `{ success: false, reason: 'not_found' }`.
 *
 * @param {string|null} token  UUID from the query string; pass null/'' to stay idle
 */
export function useNewsletterUnsubscribe(token) {
  return useQuery({
    queryKey: ['newsletter-unsubscribe', token],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('unsubscribe_newsletter', {
        p_token: token,
      })
      if (error) throw error
      return data
    },
    enabled: !!token,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}
