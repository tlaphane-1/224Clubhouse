// Node-side tenant loader, shared by vite.config.js and the build scripts.
// A store is a folder under tenants/ holding tenant.json and public/. Failing
// here, at config load, means a bad TENANT never reaches bundling and can't
// ship a page that says "undefined".
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEFAULT_TENANT = '224clubhouse'

const TENANTS_ROOT = path.dirname(fileURLToPath(import.meta.url))

// Paths a store may omit (leave out or set to null; an optional array may also
// be empty). When present they are still held to the reference shape.
// Everything else present in the 224 reference config is required of every
// store: the shared code reads those paths unguarded, so a missing one shows up
// as "undefined" on the page or a TypeError at module load. The optional ones
// are facts a new store may not have yet (no email, no social pages, no bank
// account, no reviews); the components that read them skip the field instead of
// showing a placeholder. legacyStorageKeys exists only to preserve keys that
// predate the prefix scheme.
const OPTIONAL_PATHS = [
  'legacyStorageKeys',
  'contact.email',
  'social',
  'social.facebook',
  'social.instagram',
  'bank',
  'hours.delivery',
  'legal.informationOfficer',
  'content.home.reviews',
  'content.home.newsletter.offer',
  'content.home.newsletter.offerSuffix',
  'content.login',
  // Env overrides only 224 needs: its sending domain and bank details have
  // been function secrets since before stores existed (MAIL_FROM_DOMAIN,
  // EFT_BANK_DETAILS). A new store's come from this file.
  'mail.fromDomainEnv',
  'mail.bankDetailsEnv',
]

// Static files every store must ship in tenants/<slug>/public/ (vite publicDir).
// Without them the build still exits 0 but the site 404s its favicon, manifest
// and driver-app icons.
const REQUIRED_PUBLIC_FILES = [
  'favicon.svg',
  'driver.webmanifest',
  'icons/driver-192.png',
  'icons/driver-512.png',
  'icons/driver-maskable-512.png',
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

// 224 is the reference: its tenant.json defines which fields exist and their
// types. Read lazily so importing this module never touches the filesystem.
let reference
function referenceTenant() {
  reference ??= JSON.parse(readFileSync(path.join(tenantDir(DEFAULT_TENANT), 'tenant.json'), 'utf8'))
  return reference
}

const typeOf = value => (Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value)

// Only the listed path itself is optional; once present, its children are held
// to the reference (a bank block needs a bankName). legacyStorageKeys is the
// exception: each of its keys is optional too.
const isOptional = field => OPTIONAL_PATHS.includes(field) || field.startsWith('legacyStorageKeys.')

// Compares one candidate value to its reference value, recursing into objects
// and arrays. Arrays only need to be non-empty (a store may have fewer gallery
// images); each element is held to the shape of the reference's first element.
function checkShape(ref, value, field, where) {
  if (isOptional(field) && (value === undefined || value === null || (Array.isArray(value) && value.length === 0))) {
    return
  }
  if (value === undefined || value === null) {
    throw new Error(`${where}: missing required field "${field}"`)
  }
  const expected = typeOf(ref)
  if (typeOf(value) !== expected) {
    throw new Error(`${where}: field "${field}" must be ${expected === 'array' || expected === 'object' ? 'an' : 'a'} ${expected} (got ${typeOf(value)})`)
  }
  if (expected === 'string' && value.trim() === '') {
    throw new Error(`${where}: missing required field "${field}"`)
  }
  if (expected === 'array') {
    if (value.length === 0) throw new Error(`${where}: missing required field "${field}"`)
    value.forEach((item, i) => checkShape(ref[0], item, `${field}[${i}]`, where))
  } else if (expected === 'object') {
    for (const [key, refChild] of Object.entries(ref)) {
      const childField = field ? `${field}.${key}` : key
      checkShape(refChild, value[key], childField, where)
    }
  }
}

export function validateTenant(obj, slug) {
  const where = `tenants/${slug}/tenant.json`
  checkShape(referenceTenant(), obj, '', where)

  if (obj.slug !== slug) {
    throw new Error(`${where}: slug "${obj.slug}" does not match folder "${slug}"`)
  }
  // Same range as the tenants.min_age check constraint; the two must agree.
  if (!Number.isInteger(obj.minimumAge) || obj.minimumAge < 18 || obj.minimumAge > 25) {
    throw new Error(`${where}: minimumAge must be a whole number from 18 to 25 (got ${JSON.stringify(obj.minimumAge)})`)
  }
  // Delivery fee and free-delivery threshold are integer cents (ZAR), like every
  // other amount in the app; place_cod_order charges the same numbers.
  for (const key of ['feeCents', 'freeFromCents']) {
    if (!Number.isInteger(obj.delivery[key]) || obj.delivery[key] < 0) {
      throw new Error(`${where}: delivery.${key} must be a whole number of cents, 0 or more (got ${JSON.stringify(obj.delivery[key])})`)
    }
  }
  // tailwind.config.js turns each colour into rgba() by slicing #RRGGBB.
  for (const [name, colour] of Object.entries(obj.theme.colors)) {
    if (typeof colour !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(colour)) {
      throw new Error(`${where}: theme.colors.${name} must be a #RRGGBB hex colour (got ${JSON.stringify(colour)})`)
    }
  }
  // Routes are keyed by URL path, so a store can add routes the reference lacks.
  for (const [route, entry] of Object.entries(obj.seo.routes)) {
    for (const key of ['title', 'description']) {
      if (typeof entry?.[key] !== 'string' || entry[key].trim() === '') {
        throw new Error(`${where}: missing required field "seo.routes.${route}.${key}"`)
      }
    }
  }
  for (const key of ['productDescription', 'eventDescription']) {
    const tokens = obj.seo[key].match(/\{\w+\}/g) ?? []
    if (!tokens.includes('{name}')) {
      throw new Error(`${where}: seo.${key} must contain the {name} placeholder`)
    }
    // prerender-seo only fills {name}; any other token would ship literally.
    const unknown = tokens.find(t => t !== '{name}')
    if (unknown) throw new Error(`${where}: seo.${key} has unknown placeholder ${unknown} (only {name} is filled)`)
  }
  return obj
}

// dir is a parameter only so tests can point it at a temp folder.
export function checkTenantPublic(slug, dir = tenantDir(slug)) {
  for (const file of REQUIRED_PUBLIC_FILES) {
    if (!existsSync(path.join(dir, 'public', file))) {
      throw new Error(`tenants/${slug}/public/${file}: required file not found`)
    }
  }
}

export function loadTenant(slug = resolveTenantSlug()) {
  const file = path.join(tenantDir(slug), 'tenant.json')
  if (!existsSync(file)) {
    throw new Error(`Unknown tenant "${slug}": tenants/${slug}/tenant.json not found`)
  }
  const tenant = validateTenant(JSON.parse(readFileSync(file, 'utf8')), slug)
  checkTenantPublic(slug)
  return tenant
}
