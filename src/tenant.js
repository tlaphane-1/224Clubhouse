// The only place in src/ that reads tenant.json. Everything store-specific
// (name, contact, images, storage keys) comes through here so a second store
// is a new tenants/<slug>/ folder, not a code change. '@tenant' is aliased to
// that folder in vite.config.js.
import data from '@tenant/tenant.json'

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    Object.values(value).forEach(deepFreeze)
  }
  return value
}

export const tenant = deepFreeze(data)

// legacyStorageKeys pins keys that predate the prefix scheme, so visitors who
// already have a cart / age confirmation / recent orders keep them.
export function storageKey(name) {
  return tenant.legacyStorageKeys?.[name] ?? `${tenant.storagePrefix}-${name}`
}

export function pageTitle(page) {
  return `${page} | ${tenant.name}`
}

export function adminTitle(page) {
  return `${page} | ${tenant.shortName} Admin`
}

export function storagePublicUrl(path) {
  return `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/${path}`
}
