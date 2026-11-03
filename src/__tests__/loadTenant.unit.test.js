import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolveTenantSlug, validateTenant, loadTenant, checkTenantPublic } from '../../tenants/loadTenant.mjs'

describe('resolveTenantSlug', () => {
  it('defaults to 224clubhouse when TENANT is unset', () => {
    expect(resolveTenantSlug({})).toBe('224clubhouse')
  })

  it('trims the TENANT value', () => {
    expect(resolveTenantSlug({ TENANT: ' explosive420 ' })).toBe('explosive420')
  })

  it('rejects slugs that are not lowercase letters, digits and dashes', () => {
    expect(() => resolveTenantSlug({ TENANT: 'Bad Slug' })).toThrow(/Invalid TENANT/)
  })
})

describe('loadTenant', () => {
  it('fails naming the slug when the folder does not exist', () => {
    expect(() => loadTenant('nope')).toThrow(/Unknown tenant "nope"/)
  })

  it('loads the 224 config', () => {
    expect(loadTenant('224clubhouse').name).toBe('224 Clubhouse')
  })
})

describe('validateTenant', () => {
  const valid = loadTenant('224clubhouse')

  it('names the dotted path of a missing required field', () => {
    const broken = { ...valid, contact: { ...valid.contact, email: '' } }
    expect(() => validateTenant(broken, '224clubhouse')).toThrow(/missing required field "contact.email"/)
  })

  // Deep-copies the 224 config, lets the caller break it, then validates.
  const broken = mutate => {
    const copy = structuredClone(valid)
    mutate(copy)
    return () => validateTenant(copy, '224clubhouse')
  }

  it('accepts the 224 config', () => {
    expect(() => validateTenant(structuredClone(valid), '224clubhouse')).not.toThrow()
  })

  it('does not require the optional legacyStorageKeys', () => {
    expect(broken(t => { delete t.legacyStorageKeys })).not.toThrow()
  })

  it('accepts a store with fewer gallery images and extra routes', () => {
    expect(broken(t => {
      t.images.gallery = [t.images.gallery[0]]
      t.seo.routes['/faq'] = { title: 'FAQ', description: 'Questions.' }
    })).not.toThrow()
  })

  // One case per config the first hand-maintained field list let through.
  it.each([
    ['images.gallery', t => { delete t.images.gallery }, /missing required field "images.gallery"/],
    ['images.gallery empty', t => { t.images.gallery = [] }, /missing required field "images.gallery"/],
    ['bank.bankName', t => { delete t.bank.bankName }, /missing required field "bank.bankName"/],
    ['contact.mapCentre', t => { delete t.contact.mapCentre }, /missing required field "contact.mapCentre"/],
    ['contact.phoneIntl', t => { delete t.contact.phoneIntl }, /missing required field "contact.phoneIntl"/],
    ['theme.colors.gold', t => { delete t.theme.colors.gold }, /missing required field "theme.colors.gold"/],
    ['theme.fonts.heading', t => { delete t.theme.fonts.heading }, /missing required field "theme.fonts.heading"/],
    ['hours.contactPage as a string', t => { t.hours.contactPage = 'Closed' }, /"hours.contactPage" must be an array \(got string\)/],
    ['seo.routes /store title', t => { delete t.seo.routes['/store'].title }, /missing required field "seo.routes.\/store.title"/],
    ['an added route without a description', t => { t.seo.routes['/faq'] = { title: 'FAQ', description: ' ' } }, /missing required field "seo.routes.\/faq.description"/],
    ['short hex colour', t => { t.theme.colors.gold = '#c9a' }, /theme.colors.gold must be a #RRGGBB hex colour/],
    ['gallery element of the wrong type', t => { t.images.gallery[1] = 7 }, /"images.gallery\[1\]" must be a string \(got number\)/],
    ['review missing a field', t => { delete t.content.home.reviews[0].rating }, /missing required field "content.home.reviews\[0\].rating"/],
    ['productDescription without {name}', t => { t.seo.productDescription = 'A product.' }, /seo.productDescription must contain the \{name\} placeholder/],
    ['eventDescription without {name}', t => { t.seo.eventDescription = 'An event.' }, /seo.eventDescription must contain the \{name\} placeholder/],
    ['unknown template token', t => { t.seo.productDescription = '{name} {price}' }, /unknown placeholder \{price\}/],
    ['minimumAge missing', t => { delete t.minimumAge }, /missing required field "minimumAge"/],
    ['minimumAge below 18', t => { t.minimumAge = 16 }, /minimumAge must be a whole number from 18 to 25/],
    ['minimumAge not whole', t => { t.minimumAge = 18.5 }, /minimumAge must be a whole number from 18 to 25/],
  ])('rejects %s, naming the slug and path', (_label, mutate, message) => {
    expect(broken(mutate)).toThrow(message)
    expect(broken(mutate)).toThrow(/tenants\/224clubhouse\/tenant\.json/)
  })

  it('rejects a tenant.json whose slug does not match its folder', () => {
    expect(() => validateTenant({ ...valid, slug: 'other' }, '224clubhouse')).toThrow()
  })
})

describe('checkTenantPublic', () => {
  const dirs = []
  afterEach(() => { while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }) })

  const files = ['favicon.svg', 'driver.webmanifest', 'icons/driver-192.png', 'icons/driver-512.png', 'icons/driver-maskable-512.png']
  function fixture(present) {
    const dir = mkdtempSync(path.join(tmpdir(), 'tenant-public-'))
    dirs.push(dir)
    for (const f of present) {
      mkdirSync(path.dirname(path.join(dir, 'public', f)), { recursive: true })
      writeFileSync(path.join(dir, 'public', f), '')
    }
    return dir
  }

  it('passes when every required file exists', () => {
    expect(() => checkTenantPublic('shop', fixture(files))).not.toThrow()
  })

  it('fails naming the slug and file when public/ is missing entirely', () => {
    expect(() => checkTenantPublic('shop', fixture([]))).toThrow(/tenants\/shop\/public\/favicon\.svg/)
  })

  it.each(files)('fails when %s is missing', missing => {
    const dir = fixture(files.filter(f => f !== missing))
    expect(() => checkTenantPublic('shop', dir)).toThrow(new RegExp(`tenants/shop/public/${missing.replaceAll('.', String.raw`\.`)}`))
  })
})
