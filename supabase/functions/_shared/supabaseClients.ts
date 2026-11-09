import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are injected
// into every edge function by the platform — no secrets need setting.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

/**
 * Bypasses RLS. Use ONLY to look up the facts the email needs (recipient,
 * name, order/tier details) AFTER the caller has been authorized — never to
 * decide whether the caller is allowed.
 */
export function serviceClient(tenant?: string) {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    // The service role has no tenant claim, so current_tenant() reads x-tenant
    // and otherwise means 224. Pass the store when an RPC must act for it.
    ...(tenant ? { global: { headers: { 'x-tenant': tenant } } } : {}),
  })
}

/**
 * Runs as the CALLER: anon key + their Authorization header, so auth.uid() and
 * RLS apply exactly as they do in the browser. This is what authorization
 * decisions (is_admin(), order ownership) must be made with.
 */
export function callerClient(authHeader: string) {
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * The caller's store, as the database resolves it for their JWT
 * (current_tenant(): the app_metadata.tenant claim, else 224). Null if the
 * lookup fails, and callers must refuse rather than guess: a guess of 224 is
 * exactly how another store's admin ends up writing 224's rows.
 */
export async function callerTenant(authHeader: string): Promise<string | null> {
  const { data, error } = await callerClient(authHeader).rpc('current_tenant')
  if (error || typeof data !== 'string' || !data) return null
  return data
}

/** True only for a caller whose JWT resolves to a row in admin_users. */
export async function callerIsAdmin(authHeader: string): Promise<boolean> {
  const { data, error } = await callerClient(authHeader).rpc('is_admin')
  if (error) return false
  return data === true
}
