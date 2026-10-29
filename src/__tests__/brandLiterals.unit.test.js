import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { loadTenant } from '../../tenants/loadTenant.mjs'

// Ratchet: every fact that belongs to one store must live in tenant.json, not
// in src/. The forbidden list is deliberately always built from 224's config,
// regardless of TENANT, so it catches a 224 fact leaking into shared code even
// while someone is building another store.
const tenant = loadTenant('224clubhouse')

const SRC = path.resolve(import.meta.dirname, '..')

// The bank account number is the one secret-ish line of bank.details; pull it
// from the config so the test follows the data rather than a second copy.
const accountNumber = tenant.bank.details.match(/Account number:\s*(\d+)/)?.[1]

const FORBIDDEN = [
  tenant.name,
  tenant.domain.apex,
  tenant.contact.street,
  tenant.contact.phoneDisplay,
  tenant.contact.phoneTel,
  tenant.contact.phoneIntl,
  // No contact.whatsapp field exists yet, so the digits are pinned here.
  '27750868783',
  tenant.contact.email,
  accountNumber,
  'aogdkqczvlffgydgxsmz',
  'facebook.com/224clubhouse',
  'instagram.com/224clubhouse',
  `${tenant.shortName} Admin`,
  'Boksburg',
  'Rondebult',
  'FNB',
]

// Order/payment reference and storage-key prefixes are generated from
// orderPrefix / storagePrefix, never typed.
const PREFIX_PATTERN = /['"`]224[-:]/

function sourceFiles(dir) {
  return readdirSync(dir).flatMap(entry => {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) {
      return entry === '__tests__' ? [] : sourceFiles(full)
    }
    const rel = path.relative(SRC, full).split(path.sep).join('/')
    if (!/\.(js|jsx)$/.test(entry)) return []
    if (entry.endsWith('.test.js') || rel === 'tenant.js') return []
    return [full]
  })
}

function findHits() {
  const hits = []
  for (const file of sourceFiles(SRC)) {
    const rel = path.relative(SRC, file).split(path.sep).join('/')
    readFileSync(file, 'utf8').split(/\r?\n/).forEach((text, i) => {
      for (const literal of FORBIDDEN) {
        if (text.includes(literal)) hits.push(`src/${rel}:${i + 1}: "${literal}"`)
      }
      const m = text.match(PREFIX_PATTERN)
      if (m) hits.push(`src/${rel}:${i + 1}: "${m[0]}" (literal prefix)`)
    })
  }
  return hits
}

describe('brand literals', () => {
  it('has a forbidden list with no empty entries', () => {
    expect(accountNumber).toBeTruthy()
    for (const literal of FORBIDDEN) expect(literal).toBeTruthy()
  })

  it('src/ holds no store-specific facts (they live in tenant.json)', () => {
    const hits = findHits()
    const files = new Set(hits.map(h => h.split(':')[0]))
    expect(hits, `${files.size} file(s) still hard-code store facts:\n${hits.join('\n')}`).toEqual([])
  })
})
