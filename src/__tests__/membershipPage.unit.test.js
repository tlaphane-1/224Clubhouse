/**
 * Static guard for src/pages/Membership.jsx.
 *
 * The application sheet's footer is built on every render, even while the
 * sheet is closed, and `tier` is undefined until the default-selection effect
 * has run. An unguarded `tier.price_cents` there crashed /membership for every
 * signed-in customer without a membership (2026-11-09). The project has no
 * component-render test setup, so this pins the guard in the source.
 *
 *   npx vitest run src/__tests__/membershipPage.unit.test.js
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const src = readFileSync(path.resolve(import.meta.dirname, '../pages/Membership.jsx'), 'utf8').replace(/\r\n/g, '\n')

describe('Membership page', () => {
  it('only builds the sheet footer (which reads tier.price_cents) once a tier is selected', () => {
    expect(src).toMatch(/footer=\{showForm && tier && \(/)
  })
})
