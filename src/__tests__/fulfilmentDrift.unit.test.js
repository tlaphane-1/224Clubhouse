/**
 * The fulfilment mode lives in two places: tenants/<slug>/tenant.json
 * (`delivery.mode`, read by the website and the email functions) and the
 * tenants.fulfilment column (read by place_cod_order, set_order_pin and
 * is_driver()). If they disagree, a store's checkout would hide the address
 * while the server still charges delivery, or the reverse. This test fails
 * while a tenant.json mode has no matching migration, or vice versa.
 *
 * Migrations must set the column with exactly:
 *   update public.tenants set fulfilment = '<mode>' where slug = '<slug>';
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { loadTenant } from '../../tenants/loadTenant.mjs'
import { storeSlugs } from '../../scripts/build-function-stores.mjs'

const ROOT = path.resolve(import.meta.dirname, '../..')
const MIGRATIONS = path.join(ROOT, 'supabase/migrations')
const SET_MODE = /update public\.tenants set fulfilment = '(delivery|collect)' where slug = '([a-z0-9-]+)'/g

function collectSlugsFromMigrations() {
  const modes = new Map()
  for (const file of readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(path.join(MIGRATIONS, file), 'utf8')
    for (const [, mode, slug] of sql.matchAll(SET_MODE)) modes.set(slug, mode)
  }
  return [...modes].filter(([, mode]) => mode === 'collect').map(([slug]) => slug).sort()
}

describe('fulfilment mode drift', () => {
  it('tenant.json collect stores match the stores migrations set to collect', () => {
    const fromConfig = storeSlugs().filter(slug => loadTenant(slug).delivery.mode === 'collect')
    expect(collectSlugsFromMigrations()).toEqual(fromConfig)
  })

  it('explosive420 is the collect store today', () => {
    expect(collectSlugsFromMigrations()).toEqual(['explosive420'])
  })
})
