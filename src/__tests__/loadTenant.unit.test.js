import { describe, it, expect } from 'vitest'
import { resolveTenantSlug, validateTenant, loadTenant } from '../../tenants/loadTenant.mjs'

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

  it('rejects a tenant.json whose slug does not match its folder', () => {
    expect(() => validateTenant({ ...valid, slug: 'other' }, '224clubhouse')).toThrow()
  })
})
