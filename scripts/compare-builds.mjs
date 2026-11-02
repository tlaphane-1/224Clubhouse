// Diff two dist folders, ignoring content hashes in /assets filenames.
// Used to prove a refactor leaves the 224 build byte-for-byte equivalent where
// it matters (HTML, manifests, sitemap, robots). Exit 1 on any difference.
//
//   node scripts/compare-builds.mjs <dirA> <dirB>
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const TEXT_EXT = new Set(['.html', '.webmanifest', '.xml', '.txt'])
// /assets/name-<hash>.ext  ->  /assets/name.ext  (Vite hashes are 8 chars of [A-Za-z0-9_-])
const HASHED_ASSET = /(\/assets\/[^"'\s)]*?)-[A-Za-z0-9_-]{8}(\.[A-Za-z0-9]+)/g

function listFiles(root, dir = root) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    return statSync(full).isDirectory() ? listFiles(root, full) : [path.relative(root, full).split(path.sep).join('/')]
  })
}

// Files under assets/ are matched by base name with the hash removed.
function logicalName(rel) {
  return rel.startsWith('assets/') ? rel.replace(/-[A-Za-z0-9_-]{8}(\.[A-Za-z0-9]+)$/, '$1') : rel
}

// modulepreload tags are dropped: the chunk graph shifts as more modules import
// tenant.js, but that changes what the browser fetches early, not what users see.
const MODULEPRELOAD_TAG = /[ \t]*<link\b(?=[^>]*\brel=["']modulepreload["'])[^>]*>[ \t]*\n?/g

function normalise(text) {
  return text.replace(/\r\n/g, '\n').replace(MODULEPRELOAD_TAG, '').replace(HASHED_ASSET, '$1$2')
}

// Minimal LCS line diff, enough to show what moved. Inputs are small HTML files.
function unifiedDiff(a, b, labelA, labelB) {
  const x = a.split('\n')
  const y = b.split('\n')
  const lcs = Array.from({ length: x.length + 1 }, () => new Uint32Array(y.length + 1))
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) {
      lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  const out = [`--- ${labelA}`, `+++ ${labelB}`]
  let i = 0
  let j = 0
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) { i++; j++ }
    else if (j < y.length && (i === x.length || lcs[i][j + 1] > lcs[i + 1][j])) out.push(`+${y[j++]}`)
    else out.push(`-${x[i++]}`)
  }
  return out.join('\n')
}

const [dirA, dirB] = process.argv.slice(2)
if (!dirA || !dirB) {
  console.error('Usage: node scripts/compare-builds.mjs <dirA> <dirB>')
  process.exit(2)
}

// JS chunks are left out of the file list: which chunks exist is the same
// chunk-graph artefact as the modulepreload tags, and their bodies are not
// diffed here anyway. CSS, images and everything else still count.
const isJsChunk = (rel) => rel.startsWith('assets/') && rel.endsWith('.js')
const index = (root) =>
  new Map(listFiles(root).filter((rel) => !isJsChunk(rel)).map((rel) => [logicalName(rel), rel]))
const filesA = index(dirA)
const filesB = index(dirB)
let differences = 0

for (const name of [...filesA.keys()].sort()) {
  if (!filesB.has(name)) { console.log(`only in ${dirA}: ${name}`); differences++ }
}
for (const name of [...filesB.keys()].sort()) {
  if (!filesA.has(name)) { console.log(`only in ${dirB}: ${name}`); differences++ }
}

for (const [name, relA] of [...filesA].sort()) {
  const relB = filesB.get(name)
  if (!relB || !TEXT_EXT.has(path.extname(name))) continue
  const textA = normalise(readFileSync(path.join(dirA, relA), 'utf8'))
  const textB = normalise(readFileSync(path.join(dirB, relB), 'utf8'))
  if (textA !== textB) {
    console.log(unifiedDiff(textA, textB, `${dirA}/${relA}`, `${dirB}/${relB}`))
    differences++
  }
}

if (differences) {
  console.log(`\n${differences} difference(s) found.`)
  process.exit(1)
}
console.log('Builds match (asset hashes ignored).')
