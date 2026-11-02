import { describe, it, expect } from 'vitest'
import { tenant, storageKey, pageTitle, adminTitle } from '../tenant.js'

// Returning visitors keep their cart, age confirmation, recent orders and
// analytics ids only if every key stays byte-identical to what 224 shipped.
describe('storageKey', () => {
  it.each([
    ['cart', '224-cart'],
    ['vid', '224-vid'],
    ['sid', '224-sid'],
    ['src', '224-src'],
    ['driver-install-dismissed', '224-driver-install-dismissed'],
    ['age-verified', 'age-verified'],
    ['recent-orders', '224:recent-orders'],
  ])('%s -> %s', (name, expected) => {
    expect(storageKey(name)).toBe(expected)
  })
})

describe('titles', () => {
  it('builds public page titles from the tenant name', () => {
    expect(pageTitle('The Store')).toBe('The Store | 224 Clubhouse')
  })

  it('builds admin page titles from the tenant short name', () => {
    expect(adminTitle('Orders')).toBe('Orders | 224 Admin')
  })
})

describe('tenant', () => {
  it('is deeply frozen', () => {
    expect(Object.isFrozen(tenant)).toBe(true)
    expect(Object.isFrozen(tenant.contact)).toBe(true)
  })
})
