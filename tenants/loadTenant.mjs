// Node-side tenant loader, shared by vite.config.js and the build scripts.
// A store is a folder under tenants/ holding tenant.json and public/. Failing
// here, at config load, means a bad TENANT never reaches bundling and can't
// ship a page that says "undefined".
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEFAULT_TENANT = '224clubhouse'

const TENANTS_ROOT = path.dirname(fileURLToPath(import.meta.url))

// Dotted paths that every tenant.json must carry. Later tasks append the
// fields they introduce.
const REQUIRED_FIELDS = [
  'slug',
  'name',
  'shortName',
  'legalName',
  'orderPrefix',
  'storagePrefix',
  'domain.siteUrl',
  'domain.apex',
  'domain.liveHosts',
  'contact.email',
  'contact.phoneDisplay',
  'contact.street',
  'contact.city',
  'bank.details',
  'images.logo',
  'images.logoWide',
  'images.favicon',
  'theme.colors',
  'theme.fonts',
  'theme.googleFontsUrl',
  'seo.title',
  'seo.description',
  'seo.locale',
  'seo.routes',
  'seo.productDescription',
  'seo.eventDescription',
  'images.logoWideSize',
  'images.iconSource',
  'contact.country',
  'content.footer.tagline',
  'content.ageGate.heading',
  'content.ageGate.tagline',
  'content.paperForm.letterheadStreet',
  'content.paperForm.intro',
  'content.paperForm.reasonsLegend',
  'content.paperForm.consents',
  'content.paperForm.consents.private_club',
  'content.paperForm.consents.no_redistribution',
  'content.paperForm.consents.personal_use',
  'content.paperForm.consents.release_liability',
  'content.home.heroTitle',
  'content.home.heroSubtitle',
  'content.home.reviews',
  'content.home.galleryHeading',
  'content.home.newsletter.eyebrow',
  'content.home.newsletter.heading',
  'content.home.newsletter.blurb',
  'content.home.newsletter.offer',
  'content.home.newsletter.offerSuffix',
  'content.home.newsletter.cta',
  'content.home.newsletter.welcomeToast',
  'content.about.heroLines',
  'content.about.heroIntro',
  'content.about.founderHeading',
  'content.about.founderParagraphs',
  'content.about.timeline',
  'content.about.values',
  'content.about.cta.heading',
  'content.about.cta.text',
  'content.membership.intro',
  'content.membership.requirements',
  'content.membership.rulesTitle',
  'content.membership.rules',
  'content.checkout.joinPrompt',
  'content.memberOnly.event',
  'content.memberOnly.product',
  'content.store.subtitle',
  'content.events.intro',
  'content.login.emailPlaceholder',
  'hours.contactPage',
  'contact.suburb',
  'contact.postalCode',
  'contact.province',
  'contact.phoneTel',
  'contact.mapsLink',
  'social.facebook',
  'social.instagram',
  'legal.informationOfficer',
  'legal.lastUpdated',
]

export function resolveTenantSlug(env = process.env) {
  const slug = env.TENANT?.trim() || DEFAULT_TENANT
  if (!/^[a-z0-9-]+$/.test(slug)) {
    throw new Error(`Invalid TENANT "${slug}": use lowercase letters, digits and dashes`)
  }
  return slug
}

export function tenantDir(slug) {
  return path.join(TENANTS_ROOT, slug)
}

function isMissing(value) {
  if (value === undefined || value === null) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object') return Object.keys(value).length === 0
  return false
}

export function validateTenant(obj, slug) {
  for (const field of REQUIRED_FIELDS) {
    const value = field.split('.').reduce((node, key) => node?.[key], obj)
    if (isMissing(value)) {
      throw new Error(`tenants/${slug}/tenant.json: missing required field "${field}"`)
    }
  }
  if (obj.slug !== slug) {
    throw new Error(`tenants/${slug}/tenant.json: slug "${obj.slug}" does not match folder "${slug}"`)
  }
  return obj
}

export function loadTenant(slug = resolveTenantSlug()) {
  const file = path.join(tenantDir(slug), 'tenant.json')
  if (!existsSync(file)) {
    throw new Error(`Unknown tenant "${slug}": tenants/${slug}/tenant.json not found`)
  }
  return validateTenant(JSON.parse(readFileSync(file, 'utf8')), slug)
}
