import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

// Guard: nothing under src/ may import a Node-only module. tailwind.config.js
// and tenants/loadTenant.mjs read files at config time (node:fs/path/url);
// pulling either into the browser bundle builds fine and lints clean, then
// blanks every page at runtime ("fileURLToPath is not a function"). The only
// sanctioned route from src/ to tenant data is src/tenant.js via '@tenant/'.
const SRC = path.resolve(import.meta.dirname, '..')

const NODE_BUILTINS = new Set(['fs', 'path', 'url', 'child_process', 'os'])

function isBrowserSource(rel) {
  return (
    /\.(js|jsx)$/.test(rel) &&
    !rel.startsWith('__tests__/') &&
    !/\.test\.(js|jsx)$/.test(rel)
  )
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

// Specifier of `import x from 'a'`, `import 'a'`, `export … from 'a'`,
// `import('a')` and `require('a')`.
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"])([^'"\n]+)\1/g

export function forbiddenReason(specifier) {
  if (/tailwind\.config/.test(specifier)) return 'tailwind.config is Node-only; read colours from src/tenant.js'
  if (specifier.startsWith('node:')) return 'node: built-in'
  if (NODE_BUILTINS.has(specifier)) return 'Node built-in'
  if (/(^|\/)tenants\//.test(specifier)) return 'reach tenant data through src/tenant.js (@tenant/ alias), not a path into tenants/'
  return null
}

function violations() {
  const found = []
  for (const full of walk(SRC)) {
    const rel = path.relative(SRC, full).split(path.sep).join('/')
    if (!isBrowserSource(rel)) continue
    readFileSync(full, 'utf8').split(/\r?\n/).forEach((line, i) => {
      for (const m of line.matchAll(SPECIFIER)) {
        const reason = forbiddenReason(m[2])
        if (reason) found.push(`src/${rel}:${i + 1}  '${m[2]}'  (${reason})`)
      }
    })
  }
  return found
}

describe('browser bundle imports', () => {
  it('no src/ file imports a Node-only module', () => {
    expect(violations()).toEqual([])
  })

  it('flags the modules that blanked the site', () => {
    expect(forbiddenReason('../../tailwind.config.js')).toBeTruthy()
    expect(forbiddenReason('../../tenants/loadTenant.mjs')).toBeTruthy()
    expect(forbiddenReason('node:url')).toBeTruthy()
    expect(forbiddenReason('fs')).toBeTruthy()
    expect(forbiddenReason('@tenant/tenant.json')).toBeNull()
    expect(forbiddenReason('../tenant.js')).toBeNull()
    expect(forbiddenReason('react')).toBeNull()
  })
})
