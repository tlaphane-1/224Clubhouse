import { escapeHtml } from './escapeHtml.ts'
import { denoEnv, type Store } from './stores.ts'

// Each store's real logo for emails (its wide logo on transparent, served from
// the public brand-assets bucket). Emails show it on the dark #0a0a0a
// background. Never re-type the store's name as a stand-in for the logo.

export function logoUrl(store: Store, supabaseUrl = denoEnv('SUPABASE_URL') ?? ''): string {
  return `${supabaseUrl}/storage/v1/object/public/${store.logoPath}`
}

/** An email-safe <img> of the store's logo at the given display width (px). */
export function emailLogo(store: Store, width: number, extraStyle = ''): string {
  return `<img src="${logoUrl(store)}" alt="${escapeHtml(store.name)}" width="${width}" style="display:inline-block; max-width:${width}px; height:auto; border:0; ${extraStyle}">`
}

/** "🔞 Not for persons under 21" with the store's minimum age. */
export function ageLine(store: Store): string {
  return `🔞 Not for persons under ${store.minimumAge}`
}

/**
 * The footer of the dark customer emails (receipt, status, membership,
 * welcome): small logo, address, hours, social links when the store has them,
 * age line. `extra` goes under the age line (e.g. the newsletter opt-out).
 */
export function darkFooter(store: Store, extra = ''): string {
  const links = [
    store.instagram ? `<a href="${escapeHtml(store.instagram)}" style="color:${store.gold}; text-decoration:none; font-size:12px;">Instagram</a>` : '',
    store.facebook ? `<a href="${escapeHtml(store.facebook)}" style="color:${store.gold}; text-decoration:none; font-size:12px;">Facebook</a>` : '',
  ].filter(Boolean)
  return `
    <div style="text-align:center; border-top:1px solid #222222; padding-top:28px;">
      ${emailLogo(store, 110, 'margin-bottom:16px;')}
      <p style="color:#888888; font-size:12px; margin-bottom:4px;">${escapeHtml(store.address)}</p>
      <p style="color:#888888; font-size:12px; margin-bottom:16px;">${escapeHtml(store.hours)}</p>${links.length ? `
      <div style="display:flex; justify-content:center; gap:16px; margin-bottom:16px;">
        ${links.join(`
        <span style="color:#333;">|</span>
        `)}
      </div>` : ''}
      <p style="color:#444; font-size:11px;">${ageLine(store)}</p>${extra}
    </div>`
}
