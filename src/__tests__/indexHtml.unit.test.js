import { describe, it, expect } from 'vitest'
import { renderIndexHtml } from '../../tenants/vitePlugin.mjs'
import { loadTenant } from '../../tenants/loadTenant.mjs'

const tenant = loadTenant('224clubhouse')
const TEMPLATE =
  '<title>%TENANT_TITLE%</title><meta name="description" content="%TENANT_DESCRIPTION%" /><!-- %TENANT_FONTS% -->'

const count = (haystack, needle) => haystack.split(needle).length - 1

describe('renderIndexHtml', () => {
  const out = renderIndexHtml(TEMPLATE, tenant)

  // Same escaping prerender-seo.mjs applies, so dev and the prerendered build agree.
  it('emits the title with the apostrophe escaped as the live site does', () => {
    expect(out).toContain("<title>224 Clubhouse | Private Cannabis Members&#39; Club</title>")
  })

  it('emits the description attribute-escaped', () => {
    expect(out).toContain(
      'content="224 Clubhouse — a private cannabis members&#39; club in Boksburg, South Africa. Premium cannabis, delivered to your door. Members only."',
    )
  })

  it('emits the fonts stylesheet link exactly once, with both preconnects', () => {
    expect(count(out, 'fonts.googleapis.com/css2')).toBe(1)
    expect(out).toContain(`<link rel="stylesheet" href="${tenant.theme.googleFontsUrl.replace(/&/g, '&amp;')}">`)
    expect(out).toContain('<link rel="preconnect" href="https://fonts.googleapis.com">')
    expect(out).toContain('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>')
  })

  it('leaves no placeholder behind', () => {
    expect(out).not.toContain('%TENANT_')
  })

  it.each(['%TENANT_TITLE%', '%TENANT_DESCRIPTION%', '<!-- %TENANT_FONTS% -->'])(
    'throws when %s is missing from the template',
    (placeholder) => {
      expect(() => renderIndexHtml(TEMPLATE.replace(placeholder, ''), tenant)).toThrow(/TENANT_/)
    },
  )

  it('escapes markup characters in tenant copy', () => {
    const t = { ...tenant, seo: { ...tenant.seo, title: 'A <b> & "c"', description: 'd' } }
    expect(renderIndexHtml(TEMPLATE, t)).toContain('<title>A &lt;b&gt; &amp; &quot;c&quot;</title>')
  })
})
