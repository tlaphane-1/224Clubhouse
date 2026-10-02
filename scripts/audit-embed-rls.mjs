/**
 * Static audit: every PostgREST embed in src/ (DB access lives in
 * src/hooks/), paired with what we know about RLS on the target table.
 *
 * Why this exists:
 *   A PostgREST embed (`.select('*, other_table(...)')`) against a parent
 *   table whose foreign row is RLS-restricted silently BLANKS the embed
 *   for users who can't read that foreign row — the parent row still
 *   returns, but the join column comes back null. The frontend then
 *   compares against null and silently shows nothing. That's a whole
 *   class of "works for admin, empty for everyone else" bug.
 *
 * Current state for 224 Clubhouse:
 *   This codebase has ZERO embeds — every hook does a flat .select('*').
 *   So this audit is a FUTURE GUARD: the day someone adds an embed of a
 *   row-restricted table without declaring why it's safe, CI goes red.
 *
 * What it does:
 *   1. Scans src/ for every .select('...') string and extracts embedded
 *      table names.
 *   2. Harvests FOR SELECT RLS policies from supabase/migrations/*.sql
 *      and classifies each target table as open / row-restricted.
 *   3. Classifies each embed: open / exempt / RISKY / unknown.
 *   4. Exits non-zero if any embed is RISKY without a documented
 *      exemption.
 *
 * Output:
 *   Markdown table to stdout (or JSON with --json).
 *
 * Usage:
 *   node scripts/audit-embed-rls.mjs
 *   node scripts/audit-embed-rls.mjs --json
 *
 * To add a new safe embed: add an entry to EXEMPT_EMBEDS keyed by
 * `file:line:embedKey` (run the audit to copy the exact key) with a
 * one-line safety reason.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
// DB access lives in src/hooks, but scan all of src/ so an embed added
// in a component, page, or lib is caught too.
const SRC = join(ROOT, 'src')
const MIGRATIONS = join(ROOT, 'supabase', 'migrations')

const JSON_OUT = process.argv.includes('--json')

// ── 1. Find every select('...embed_table(...)...') call in src/ ──────────
const EMBED_RE = /\.select\(\s*['"`]([^'"`]+)['"`]/g
const EMBED_INNER_RE = /(\w+)(?::\w+)?\s*\(/g

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    // Skip test directories/files — they aren't app data-access code and
    // their example/illustrative select strings would be phantom embeds.
    if (st.isDirectory()) {
      if (name === '__tests__') continue
      walk(p, out)
    } else if (/\.(js|jsx|ts|tsx)$/.test(name) && !/\.(test|spec)\.[jt]sx?$/.test(name)) {
      out.push(p)
    }
  }
  return out
}

function findEmbeds() {
  const hits = []
  if (!existsSync(SRC)) return hits
  for (const file of walk(SRC)) {
    const src = readFileSync(file, 'utf8')
    let m
    EMBED_RE.lastIndex = 0
    while ((m = EMBED_RE.exec(src)) !== null) {
      const selectStr = m[1]
      const embeds = []
      let inner
      EMBED_INNER_RE.lastIndex = 0
      while ((inner = EMBED_INNER_RE.exec(selectStr)) !== null) {
        embeds.push(inner[1])
      }
      if (!embeds.length) continue
      const upto = src.slice(0, m.index)
      const lineNo = upto.split('\n').length
      hits.push({ file: relative(ROOT, file).replace(/\\/g, '/'), line: lineNo, embeds, raw: selectStr })
    }
  }
  return hits
}

// ── 2. Classify each target table's RLS posture ──────────────────────────
// Handles three CREATE POLICY name shapes:
//   "Quoted name with spaces"   →  "([^"]+)"
//   'single quoted'             →  '([^']+)'
//   bare_identifier             →  (\w+)
// plus an optional FOR SELECT / TO role / USING(...) clause. Matches
// across newlines and skips DROP/ALTER policy variants.
const POLICY_RE = /CREATE\s+POLICY\s+(?:"([^"]+)"|'([^']+)'|(\w+))\s+ON\s+(\w+)\s+FOR\s+(\w+)[\s\S]*?USING\s*\(([\s\S]+?)\)\s*(?:WITH\s+CHECK|;)/gi

function classifyRls() {
  const byTable = new Map()
  if (!existsSync(MIGRATIONS)) return byTable
  const files = readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS, f), 'utf8')
    let m
    POLICY_RE.lastIndex = 0
    while ((m = POLICY_RE.exec(sql)) !== null) {
      const [, polDq, polSq, polBare, table, action, using] = m
      const policy = polDq || polSq || polBare
      if (action.toUpperCase() !== 'SELECT') continue
      const entry = byTable.get(table) || { policies: [] }
      const openish = /^\s*true\s*$/i.test(using.trim())
      const ownerOnly = /auth\.uid\(\)|is_admin|auth\.role\(\)|owner|self/i.test(using)
      entry.policies.push({ policy, file: f, openish, ownerOnly, using: using.trim() })
      byTable.set(table, entry)
    }
  }
  for (const [, e] of byTable) {
    e.hasOpenSelect = e.policies.some(p => p.openish)
    e.hasRowRestrictedSelect = e.policies.some(p => p.ownerOnly && !p.openish)
  }
  return byTable
}

// ── 3. Per-table baseline (does NOT silence per-site decisions) ──────────
// A table here is "open enough" that embedding it needs no per-call
// exemption. Use sparingly — only for tables with genuine
// FOR SELECT USING (true) policies and no PII columns.
const OPEN_TABLES = new Set([
  // 'products' and 'events' have public SELECT, but nothing embeds them
  // today. Listed here so a future flat-FK embed of reference data
  // wouldn't trip the audit unnecessarily.
  'products',
  'events',
])

// ── 4. EXEMPT_EMBEDS — keyed by file:line:embedKey ───────────────────────
// Every risky embed MUST declare why it's safe at its own call site.
// Empty today because this app has zero embeds. When you add one of a
// row-restricted table, run the audit, copy the file:line:embed key it
// prints, and add an entry here with a one-line reason.
const EXEMPT_EMBEDS = new Map([
  // ['src/hooks/useThing.js:42:other_table', 'why this embed is safe'],
])

function isExempt(file, line, embedKey) {
  // Most specific key first (file:line:embed), then file:embed for a
  // function that moved but whose embed shape is documented. Table-only
  // keys are intentionally unsupported — they wildcard too broadly.
  return EXEMPT_EMBEDS.get(`${file}:${line}:${embedKey}`)
      || EXEMPT_EMBEDS.get(`${file}:${embedKey}`)
      || null
}

// ── 5. Build report ──────────────────────────────────────────────────────
const embeds = findEmbeds()
const rls = classifyRls()

const rows = []
let problems = 0
for (const hit of embeds) {
  for (const embed of hit.embeds) {
    const aliasMatch = hit.raw.match(new RegExp(`(${embed}(?::\\w+|!\\w+)?)\\s*\\(`))
    const embedKey = aliasMatch ? aliasMatch[1] : embed
    const tableInfo = rls.get(embed) || {}
    const isBaselineOpen = OPEN_TABLES.has(embed) || (tableInfo.hasOpenSelect && !tableInfo.hasRowRestrictedSelect)
    const isRisky = tableInfo.hasRowRestrictedSelect
    const exemption = isExempt(hit.file, hit.line, embedKey)
    const status = isBaselineOpen ? 'open'
                : exemption ? 'exempt'
                : isRisky ? 'RISKY'
                : 'unknown'
    if (status === 'RISKY') problems++
    rows.push({
      file: hit.file,
      line: hit.line,
      embed: embedKey,
      status,
      reason: exemption || (isRisky ? 'parent table has row-restricted RLS — declare safety at this file:line' : ''),
    })
  }
}

if (JSON_OUT) {
  console.log(JSON.stringify({ rows, problems }, null, 2))
} else {
  console.log('| file | line | embed | status | reason |')
  console.log('|------|------|-------|--------|--------|')
  for (const r of rows) {
    console.log(`| ${r.file} | ${r.line} | \`${r.embed}\` | ${r.status} | ${r.reason} |`)
  }
  console.log('')
  console.log(`Embeds inspected: ${rows.length}`)
  console.log(`Risky without exemption: ${problems}`)
}

process.exit(problems > 0 ? 1 : 0)
