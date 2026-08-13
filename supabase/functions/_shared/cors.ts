// Shared CORS headers for every edge function.
//
// supabase.functions.invoke() sends authorization / apikey / x-client-info /
// content-type, so the preflight MUST advertise those in
// Access-Control-Allow-Headers or the browser blocks the request before it is
// ever sent — and the callers' fire-and-forget .catch() swallows the failure
// silently. Every response (preflight, success AND error) has to carry
// Access-Control-Allow-Origin too, not just the OPTIONS one.
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** CORS + JSON — spread into every non-preflight response. */
export const jsonHeaders = {
  ...corsHeaders,
  'Content-Type': 'application/json',
}

/** JSON response that always carries CORS. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders })
}
