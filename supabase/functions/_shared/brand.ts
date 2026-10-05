// The club's real logo for emails (white "224 · CLUBHOUSE" mark on transparent,
// served from the public brand-assets bucket). Emails show it on the dark
// #0a0a0a background. Never re-type "224" as a stand-in for the logo.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''

export const LOGO_URL = `${SUPABASE_URL}/storage/v1/object/public/brand-assets/224-logo-fav-1-480x142.png`

/** An email-safe <img> of the logo at the given display width (px). */
export function emailLogo(width: number, extraStyle = ''): string {
  return `<img src="${LOGO_URL}" alt="224 Clubhouse" width="${width}" style="display:inline-block; max-width:${width}px; height:auto; border:0; ${extraStyle}">`
}
