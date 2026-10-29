// Node-side Vite plugin: fills the tenant-specific parts of index.html.
// Lives beside loadTenant.mjs because it runs at build/dev time, not in the bundle.

// Same escaping as scripts/prerender-seo.mjs (escAttr), so the dev page and the
// prerendered pages carry identical title/description bytes.
const escapeHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Fonts used to be a CSS @import, which the browser only discovers after the
// stylesheet downloads. As <link> tags with preconnect they start earlier.
const fontsTags = (url) =>
  '<link rel="preconnect" href="https://fonts.googleapis.com">'
  + '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
  + `<link rel="stylesheet" href="${escapeHtml(url)}">`

/**
 * @param {string} html index.html containing the three placeholders
 * @param {object} tenant validated tenant config
 * @returns {string}
 */
export function renderIndexHtml(html, tenant) {
  const replacements = [
    ['%TENANT_TITLE%', escapeHtml(tenant.seo.title)],
    ['%TENANT_DESCRIPTION%', escapeHtml(tenant.seo.description)],
    ['<!-- %TENANT_FONTS% -->', fontsTags(tenant.theme.googleFontsUrl)],
  ]
  let out = html
  for (const [placeholder, value] of replacements) {
    // A silently missing placeholder would ship a page with no title or no fonts.
    if (!out.includes(placeholder)) {
      throw new Error(`index.html is missing the ${placeholder} placeholder`)
    }
    // Function replacer: tenant text may contain "$&"-style patterns.
    out = out.replace(placeholder, () => value)
  }
  return out
}

/** @returns {import('vite').Plugin} */
export function tenantVitePlugin(tenant) {
  return {
    name: 'tenant-index-html',
    transformIndexHtml: (html) => renderIndexHtml(html, tenant),
  }
}
