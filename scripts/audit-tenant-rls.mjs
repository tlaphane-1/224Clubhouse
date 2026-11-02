/**
 * Static tenant audit: every RLS policy on a tenant table, and every
 * SECURITY DEFINER function that touches one, must filter by tenant.
 *
 * Why this exists:
 *   The database is shared by every store. RLS policies are the boundary for
 *   direct table access, and SECURITY DEFINER RPCs bypass RLS entirely, so
 *   each one has to apply the tenant filter itself. A policy or RPC added
 *   later that forgets it silently exposes one store's rows to another. This
 *   audit makes that a red CI run instead of a production leak.
 *
 * What it does:
 *   1. Reads supabase/migrations/*.sql in filename order and replays them to
 *      the FINAL set of policies, functions and triggers (a later
 *      `create or replace` / `drop` wins).
 *   2. Tenant tables = those that gain a `tenant` column in any migration.
 *   3. Fails when
 *        - a policy on a tenant table (or a storage.objects policy for the
 *          payment-proofs bucket) lacks `current_tenant()` in USING, or in
 *          WITH CHECK where the command writes;
 *        - a final SECURITY DEFINER function whose body names a tenant table
 *          contains neither `current_tenant()` nor `v_tenant`;
 *        - a migration uses a statement form this script does not model
 *          (reported as `unsupported`, never silently skipped).
 *
 * Statement forms understood (grep'd from the repo; extend only when a
 * migration needs one):
 *   create policy NAME on [schema.]TABLE [as ..] [for CMD] [to ..] [using (..)] [with check (..)]
 *   drop policy [if exists] NAME on [schema.]TABLE
 *   create [or replace] function [schema.]NAME(args) ... [security definer] ... as $tag$ body $tag$
 *   drop function [if exists] [schema.]NAME[(arg types)] [, ...]
 *   create [or replace] trigger NAME ... on TABLE ... execute function FN(..)
 *   drop trigger [if exists] NAME on TABLE
 *   alter table TABLE add [column] [if not exists] tenant ...
 *   create table TABLE ( ..., tenant ..., )
 *   do $$ ... foreach t in array array['a','b'] ... add column ... tenant ... $$
 *     (the dynamic form 20261102120000_tenant_columns.sql uses; the table list
 *      is read from the array literal)
 *
 * Usage:
 *   node scripts/audit-tenant-rls.mjs
 *   node scripts/audit-tenant-rls.mjs --json
 *
 * Exit 1 when there are problems. The module is importable without side
 * effects; the CLI only runs when this file is the entry point.
 *
 * Fixing a report: a real gap gets a new migration that adds the predicate.
 * Do not widen ALLOWED_FUNCTIONS to silence one; a false positive is a parser
 * bug and gets fixed here.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(import.meta.dirname, '..')
const MIGRATIONS = join(ROOT, 'supabase', 'migrations')

/**
 * SECURITY DEFINER functions exempt from the body check, with the reason.
 * is_admin / is_driver compare the caller's row against current_tenant()
 * themselves; the six probes only return `true` so a test can tell whether a
 * migration has been applied, and read no table.
 */
export const ALLOWED_FUNCTIONS = new Map([
  ['is_admin', 'compares admin_users.tenant to current_tenant() directly'],
  ['is_driver', 'compares drivers.tenant to current_tenant() directly'],
  ['tenancy_applied', 'capability probe, returns true'],
  ['age_verification_applied', 'capability probe, returns true'],
  ['cart_reminders_applied', 'capability probe, returns true'],
  ['discount_newsletter_fixes_applied', 'capability probe, returns true'],
  ['eft_verification_applied', 'capability probe, returns true'],
  ['product_variants_applied', 'capability probe, returns true'],
])

// ── 1. Lexing ───────────────────────────────────────────────────────────────
// Splits SQL into code / comment / string / quoted-identifier / dollar-quoted
// segments, so nothing downstream ever looks inside a literal or a comment.
function tokenize(sql) {
  const segs = []
  const n = sql.length
  let code = ''
  let i = 0
  const flush = () => {
    if (code) segs.push({ type: 'code', text: code })
    code = ''
  }
  while (i < n) {
    const c = sql[i]
    const c2 = sql[i + 1]
    if (c === '-' && c2 === '-') {
      flush()
      let j = sql.indexOf('\n', i)
      if (j < 0) j = n
      segs.push({ type: 'comment', text: sql.slice(i, j) })
      i = j
    } else if (c === '/' && c2 === '*') {
      flush()
      let depth = 1
      let j = i + 2
      while (j < n && depth > 0) {
        if (sql[j] === '/' && sql[j + 1] === '*') { depth++; j += 2 }
        else if (sql[j] === '*' && sql[j + 1] === '/') { depth--; j += 2 }
        else j++
      }
      segs.push({ type: 'comment', text: sql.slice(i, j) })
      i = j
    } else if (c === "'") {
      flush()
      // E'...' strings treat backslash as an escape; plain strings do not.
      const escapes = /[eE]/.test(sql[i - 1] || '') && !/[\w$]/.test(sql[i - 2] || '')
      let j = i + 1
      while (j < n) {
        if (escapes && sql[j] === '\\') j += 2
        else if (sql[j] === "'" && sql[j + 1] === "'") j += 2
        else if (sql[j] === "'") break
        else j++
      }
      segs.push({ type: 'string', text: sql.slice(i, j + 1) })
      i = j + 1
    } else if (c === '"') {
      flush()
      let j = i + 1
      while (j < n) {
        if (sql[j] === '"' && sql[j + 1] === '"') j += 2
        else if (sql[j] === '"') break
        else j++
      }
      segs.push({ type: 'ident', text: sql.slice(i, j + 1) })
      i = j + 1
    } else if (c === '$' && !/[\w$]/.test(sql[i - 1] || '')) {
      const m = /^\$([A-Za-z_][\w]*)?\$/.exec(sql.slice(i, i + 64))
      if (!m) { code += c; i++; continue }
      flush()
      const open = m[0]
      const end = sql.indexOf(open, i + open.length)
      const innerEnd = end < 0 ? n : end
      const close = end < 0 ? '' : open
      segs.push({
        type: 'dollar',
        open,
        close,
        inner: sql.slice(i + open.length, innerEnd),
        text: sql.slice(i, innerEnd + close.length),
      })
      i = innerEnd + close.length
    } else {
      code += c
      i++
    }
  }
  flush()
  return segs
}

const newlines = (s) => (s.match(/\n/g) || []).length

/** Splits migration SQL on `;`, returning [{ text, line }] with comments removed. */
function splitWithLines(sql) {
  const out = []
  let cur = ''
  let start = null
  let line = 1
  const end = () => {
    if (cur.trim()) out.push({ text: cur.trim(), line: start })
    cur = ''
    start = null
  }
  for (const seg of tokenize(sql)) {
    if (seg.type === 'comment') {
      cur += ' '
      line += newlines(seg.text)
    } else if (seg.type === 'code') {
      for (const ch of seg.text) {
        if (ch === ';') { end(); continue }
        cur += ch
        if (start === null && !/\s/.test(ch)) start = line
        if (ch === '\n') line++
      }
    } else {
      if (start === null) start = line
      cur += seg.text
      line += newlines(seg.text)
    }
  }
  end()
  return out
}

/**
 * Splits SQL on `;` outside `$tag$` bodies, quotes and comments.
 * Comments are removed from the returned statements.
 */
export function splitStatements(sql) {
  return splitWithLines(sql).map((s) => s.text)
}

/** Same length as `text`, with every literal / quoted identifier blanked to `_`. */
function mask(text) {
  return tokenize(text)
    .map((s) => (s.type === 'code' ? s.text : s.type === 'comment' ? ' '.repeat(s.text.length) : '_'.repeat(s.text.length)))
    .join('')
}

/** Removes comments everywhere, including inside dollar-quoted bodies. */
function stripComments(text) {
  return tokenize(text)
    .map((s) => {
      if (s.type === 'comment') return ' '
      if (s.type === 'dollar') return s.open + stripComments(s.inner) + s.close
      return s.text
    })
    .join('')
}

/** Comments dropped and every string / dollar literal emptied: for word searches. */
function stripLiterals(text) {
  return tokenize(text)
    .map((s) => (s.type === 'comment' ? ' ' : s.type === 'string' || s.type === 'dollar' ? "''" : s.text))
    .join('')
}

// ── 2. Small parsing helpers ────────────────────────────────────────────────
const IDENT = '(?:"(?:[^"]|"")+"|[A-Za-z_][\\w$]*)'
const QNAME = `${IDENT}(?:\\s*\\.\\s*${IDENT})*`

function unquote(part) {
  const p = part.trim()
  return p.startsWith('"') ? p.slice(1, -1).replace(/""/g, '"') : p.toLowerCase()
}

/** `"public"."Orders"` -> `orders`; a leading `public.` is dropped, other schemas kept. */
function normName(q) {
  const parts = q.match(new RegExp(IDENT, 'g')).map(unquote)
  if (parts.length > 1 && parts[0] === 'public') parts.shift()
  return parts.join('.')
}

/** depth[i] = parenthesis depth before char i of a masked string. */
function depths(masked) {
  const d = new Array(masked.length + 1)
  let depth = 0
  for (let i = 0; i < masked.length; i++) {
    d[i] = depth
    if (masked[i] === '(') depth++
    else if (masked[i] === ')') depth--
  }
  d[masked.length] = depth
  return d
}

/** Index of the `)` that closes the `(` at `open`, in a masked string. */
function closeParen(masked, open) {
  let depth = 0
  for (let i = open; i < masked.length; i++) {
    if (masked[i] === '(') depth++
    else if (masked[i] === ')' && --depth === 0) return i
  }
  return masked.length
}

/** First regex match that sits at parenthesis depth 0 of `masked`, or null. */
function findTop(masked, re) {
  const d = depths(masked)
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)
  let m
  while ((m = g.exec(masked)) !== null) {
    if (d[m.index] === 0) return m
    if (m[0] === '') g.lastIndex++
  }
  return null
}

/** The text inside the parenthesis opened at the end of match `m` (offsets as in `text`). */
function clauseAfter(text, masked, m) {
  if (!m) return null
  const open = m.index + m[0].length - 1
  return text.slice(open + 1, closeParen(masked, open))
}

function splitTopLevel(text, sep = ',') {
  const masked = mask(text)
  const d = depths(masked)
  const parts = []
  let last = 0
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] === sep && d[i] === 0) {
      parts.push(text.slice(last, i))
      last = i + 1
    }
  }
  parts.push(text.slice(last))
  return parts.filter((p) => p.trim())
}

// Argument types are compared after this normalisation so `create` (with
// parameter names, defaults and aliases) and `drop` (types only) agree.
const TYPE_FIRST_WORDS = new Set(['double', 'character', 'timestamp', 'time', 'bit', 'national', 'interval'])
const TYPE_ALIASES = new Map([
  ['int', 'integer'], ['int4', 'integer'], ['int8', 'bigint'], ['int2', 'smallint'],
  ['float8', 'double precision'], ['float4', 'real'], ['bool', 'boolean'], ['decimal', 'numeric'],
  ['character varying', 'varchar'], ['timestamp with time zone', 'timestamptz'],
  ['timestamp without time zone', 'timestamp'], ['time with time zone', 'timetz'],
])

function normArgType(arg) {
  const masked = mask(arg)
  const cut = findTop(masked, /\bdefault\b|=/i)
  let s = (cut ? arg.slice(0, cut.index) : arg).trim().replace(/\s+/g, ' ')
  s = s.replace(/^(?:in|out|inout|variadic)\s+/i, '')
  const tokens = s.split(' ')
  if (tokens.length >= 2 && !TYPE_FIRST_WORDS.has(tokens[0].toLowerCase())) tokens.shift()
  s = tokens.join(' ').toLowerCase().replace(/"/g, '').replace(/^public\./, '').replace(/\s*\([^)]*\)/g, '')
  return TYPE_ALIASES.get(s) || s
}

const argTypes = (argText) => splitTopLevel(argText).map(normArgType)
const fnKey = (name, types) => `${name}(${types.join(',')})`

// ── 3. Replaying migrations ─────────────────────────────────────────────────
const ADD_TENANT_COLUMN = /\badd\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?"?tenant"?\s+[A-Za-z]/i

function parsePolicy(text) {
  const head = new RegExp(`^create\\s+policy\\s+(${IDENT})\\s+on\\s+(${QNAME})`, 'i').exec(text)
  if (!head) return null
  const rest = text.slice(head[0].length)
  const masked = mask(rest)
  const cmd = findTop(masked, /\bfor\s+(all|select|insert|update|delete)\b/i)
  return {
    name: unquote(head[1]),
    table: normName(head[2]),
    cmd: cmd ? cmd[1].toLowerCase() : 'all',
    using: clauseAfter(rest, masked, findTop(masked, /\busing\s*\(/i)),
    check: clauseAfter(rest, masked, findTop(masked, /\bwith\s+check\s*\(/i)),
  }
}

function parseFunction(text) {
  const head = new RegExp(`^create\\s+(?:or\\s+replace\\s+)?function\\s+(${QNAME})\\s*\\(`, 'i').exec(text)
  if (!head) return null
  const masked = mask(text)
  const open = head[0].length - 1
  const close = closeParen(masked, open)
  const types = argTypes(text.slice(open + 1, close))
  // Header = code between the argument list and the body; the body is the
  // first dollar-quoted block (or a string right after `as`).
  let header = ''
  let body = ''
  for (const seg of tokenize(text.slice(close + 1))) {
    if (seg.type === 'dollar') { body = seg.inner; break }
    if (seg.type === 'string' && /\bas\s*$/i.test(header)) { body = seg.text.slice(1, -1).replace(/''/g, "'"); break }
    if (seg.type === 'code') header += seg.text
  }
  const name = normName(head[1])
  return { name, key: fnKey(name, types), securityDefiner: /\bsecurity\s+definer\b/i.test(header), body }
}

function parseDropFunctions(text) {
  const head = /^drop\s+function\s+(?:if\s+exists\s+)?/i.exec(text)
  if (!head) return null
  return splitTopLevel(text.slice(head[0].length)).map((piece) => {
    const m = new RegExp(`^\\s*(${QNAME})\\s*(\\()?`, 'i').exec(piece)
    if (!m) return null
    const name = normName(m[1])
    if (!m[2]) return { name, key: null }
    const open = m[0].length - 1
    const close = closeParen(mask(piece), open)
    return { name, key: fnKey(name, argTypes(piece.slice(open + 1, close))) }
  }).filter(Boolean)
}

/** Tables that gain a `tenant` column in this statement. Returns { tables, unresolved }. */
function tenantTablesOf(text) {
  const masked = mask(text)
  const alter = new RegExp(`^alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?(${QNAME})`, 'i').exec(text)
  if (alter) {
    return ADD_TENANT_COLUMN.test(masked.slice(alter[0].length))
      ? { tables: [normName(alter[1])], unresolved: false }
      : { tables: [], unresolved: false }
  }
  const create = new RegExp(`^create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?(${QNAME})\\s*\\(`, 'i').exec(text)
  if (create) {
    const d = depths(masked)
    const col = /[(,]\s*"?tenant"?\s+[A-Za-z]/gi
    let m
    while ((m = col.exec(masked)) !== null) {
      if (d[m.index] === 1) return { tables: [normName(create[1])], unresolved: false }
    }
    return { tables: [], unresolved: false }
  }
  if (/^do\b/i.test(text)) {
    const dollar = tokenize(text).find((s) => s.type === 'dollar')
    if (!dollar) return { tables: [], unresolved: false }
    const body = stripComments(dollar.inner)
    if (!/\badd\s+column\s+(?:if\s+not\s+exists\s+)?tenant\b/i.test(body)) return { tables: [], unresolved: false }
    const list = /foreach\s+\w+\s+in\s+array\s+array\s*\[([^\]]*)\]/i.exec(body)
    const names = list ? [...list[1].matchAll(/'([^']+)'/g)].map((m) => m[1].toLowerCase()) : []
    return { tables: names, unresolved: names.length === 0 }
  }
  return { tables: [], unresolved: false }
}

const UNSUPPORTED = [
  [/^alter\s+function\b[\s\S]*\b(?:security|rename|set\s+schema)\b/i, 'alter function changing security, name or schema'],
  [/^alter\s+policy\b/i, 'alter policy'],
  [/^drop\s+table\b/i, 'drop table'],
  [new RegExp(`^alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?${QNAME}\\s+rename\\s+to\\b`, 'i'), 'alter table ... rename to'],
]

/**
 * Replays migrations in filename order.
 * @param {{ name: string, sql: string }[]} files
 * @returns {{ tenantTables: Set<string>, policies: Map, functions: Map, triggers: Map, unsupported: object[] }}
 */
export function finalState(files) {
  const state = {
    tenantTables: new Set(),
    policies: new Map(),
    functions: new Map(),
    triggers: new Map(),
    unsupported: [],
  }
  const ordered = [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const file of ordered) {
    for (const { text, line } of splitWithLines(file.sql)) {
      const at = { file: file.name, line }

      const unsupported = UNSUPPORTED.find(([re]) => re.test(text))
      if (unsupported) {
        state.unsupported.push({
          kind: 'unsupported',
          name: text.split(/\s+/).slice(0, 3).join(' ').toLowerCase(),
          ...at,
          detail: `${unsupported[1]} is not modelled by the tenant audit; teach scripts/audit-tenant-rls.mjs about it`,
        })
        continue
      }

      const cols = tenantTablesOf(text)
      cols.tables.forEach((t) => state.tenantTables.add(t))
      if (cols.unresolved) {
        state.unsupported.push({
          kind: 'unsupported',
          name: 'do $$',
          ...at,
          detail: 'a DO block adds a tenant column but no `foreach .. in array array[..]` table list could be read',
        })
      }

      const policy = parsePolicy(text)
      if (policy) {
        state.policies.set(`${policy.table}::${policy.name}`, { ...policy, ...at })
        continue
      }
      const dropPolicy = new RegExp(`^drop\\s+policy\\s+(?:if\\s+exists\\s+)?(${IDENT})\\s+on\\s+(${QNAME})`, 'i').exec(text)
      if (dropPolicy) {
        state.policies.delete(`${normName(dropPolicy[2])}::${unquote(dropPolicy[1])}`)
        continue
      }

      const fn = parseFunction(text)
      if (fn) {
        state.functions.set(fn.key, { ...fn, ...at })
        continue
      }
      const drops = parseDropFunctions(text)
      if (drops) {
        for (const d of drops) {
          if (d.key) state.functions.delete(d.key)
          else for (const [k, f] of state.functions) if (f.name === d.name) state.functions.delete(k)
        }
        continue
      }

      const trig = new RegExp(
        `^create\\s+(?:or\\s+replace\\s+)?(?:constraint\\s+)?trigger\\s+(${IDENT})\\s[\\s\\S]*?\\bon\\s+(${QNAME})`, 'i',
      ).exec(text)
      if (trig) {
        const exec = new RegExp(`\\bexecute\\s+(?:function|procedure)\\s+(${QNAME})`, 'i').exec(text)
        const table = normName(trig[2])
        state.triggers.set(`${table}::${unquote(trig[1])}`, {
          name: unquote(trig[1]), table, fn: exec ? normName(exec[1]) : null, ...at,
        })
        continue
      }
      const dropTrig = new RegExp(`^drop\\s+trigger\\s+(?:if\\s+exists\\s+)?(${IDENT})\\s+on\\s+(${QNAME})`, 'i').exec(text)
      if (dropTrig) state.triggers.delete(`${normName(dropTrig[2])}::${unquote(dropTrig[1])}`)
    }
  }
  return state
}

// ── 4. The rules ────────────────────────────────────────────────────────────
const TENANT_PREDICATE = /\bcurrent_tenant\s*\(\s*\)/i
const TENANT_VARIABLE = /\bv_tenant\b/i
const hasPredicate = (clause) => clause != null && TENANT_PREDICATE.test(stripLiterals(clause))

function policyProblems(p) {
  const issues = []
  const writes = p.cmd === 'insert' || p.cmd === 'update' || p.cmd === 'all'
  if (p.cmd !== 'insert' && !hasPredicate(p.using)) {
    issues.push(p.using == null ? 'has no USING clause' : 'USING lacks current_tenant()')
  }
  if (writes) {
    // For UPDATE and ALL, Postgres reuses USING as the check when WITH CHECK is
    // omitted, so a missing check is only a gap for INSERT.
    const implicit = p.cmd !== 'insert' && p.check == null
    if (!implicit && !hasPredicate(p.check)) {
      issues.push(p.check == null ? 'has no WITH CHECK clause' : 'WITH CHECK lacks current_tenant()')
    }
  }
  return issues
}

/**
 * @param {ReturnType<typeof finalState>} state
 * @returns {{ tables: string[], problems: { kind: string, name: string, file: string, line: number, detail: string }[] }}
 */
export function audit(state) {
  const tables = [...state.tenantTables].sort()
  const problems = state.unsupported.map((u) => ({ ...u }))

  for (const p of state.policies.values()) {
    const proofs = p.table === 'storage.objects' && /payment-proofs/.test(`${p.using || ''} ${p.check || ''}`)
    if (!state.tenantTables.has(p.table) && !proofs) continue
    for (const detail of policyProblems(p)) {
      problems.push({
        kind: 'policy',
        name: `${p.table}.${p.name}`,
        file: p.file,
        line: p.line,
        detail: `policy ${p.name} on ${p.table} (for ${p.cmd}) ${detail}`,
      })
    }
  }

  for (const f of state.functions.values()) {
    if (!f.securityDefiner || ALLOWED_FUNCTIONS.has(f.name)) continue
    const body = stripLiterals(f.body)
    const named = tables.filter((t) => new RegExp(`(?<![\\w$])(?:public\\s*\\.\\s*)?"?${t}"?(?![\\w$])`, 'i').test(body))
    if (!named.length || TENANT_PREDICATE.test(body) || TENANT_VARIABLE.test(body)) continue
    problems.push({
      kind: 'function',
      name: f.key,
      file: f.file,
      line: f.line,
      detail: `SECURITY DEFINER function names tenant table(s) ${named.join(', ')} but never uses current_tenant() or v_tenant`,
    })
  }

  problems.sort((a, b) => (a.file + String(a.line).padStart(8, '0') + a.name).localeCompare(b.file + String(b.line).padStart(8, '0') + b.name))
  return { tables, problems }
}

/** Reads and audits every migration in the repo. */
export function auditRepo(dir = MIGRATIONS) {
  const names = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.sql')).sort() : []
  const files = names.map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') }))
  return audit(finalState(files))
}

// ── 5. CLI ──────────────────────────────────────────────────────────────────
function main() {
  const result = auditRepo()
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log(`Tenant tables (${result.tables.length}): ${result.tables.join(', ')}`)
    if (!result.problems.length) {
      console.log('No tenant problems found.')
    } else {
      console.log(`\n${result.problems.length} problem(s):`)
      for (const p of result.problems) {
        console.log(`  [${p.kind}] ${p.name}  (${relative(ROOT, join(MIGRATIONS, p.file)).replace(/\\/g, '/')}:${p.line})`)
        console.log(`      ${p.detail}`)
      }
    }
  }
  process.exit(result.problems.length ? 1 : 0)
}

const entry = process.argv[1] ? resolve(process.argv[1]) : ''
const self = fileURLToPath(import.meta.url)
const sameFile = process.platform === 'win32' ? entry.toLowerCase() === self.toLowerCase() : entry === self
if (sameFile) main()
