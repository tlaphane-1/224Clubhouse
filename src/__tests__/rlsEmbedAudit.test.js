/**
 * Wrapper for the static embed/RLS audit (Layer 3).
 *
 * Runs scripts/audit-embed-rls.mjs and asserts it found zero
 * undocumented RISKY embeds. The existence of this gate is the
 * prevention: the day someone adds a `.select('*, table(...)')` against
 * a row-restricted table without a documented exemption, this test
 * (and CI) goes red.
 *
 * IMPORTANT: this codebase currently has ZERO embeds — every hook does
 * a flat .select('*'). So unlike the reference implementation we do NOT
 * assert `rows.length > 0`; that would fail on a clean, correct repo.
 * "0 embeds inspected, 0 problems" IS the expected current state. This
 * is a forward guard, not a check that embeds already exist.
 *
 * To register a new safe embed: add an entry to EXEMPT_EMBEDS in
 * scripts/audit-embed-rls.mjs (keyed by file:line:embed) with a reason.
 */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

describe('RLS embed audit', () => {
  it('audit runs and reports zero risky embeds (0 embeds is the expected state)', () => {
    const script = join(process.cwd(), 'scripts', 'audit-embed-rls.mjs')
    let report
    try {
      report = execFileSync('node', [script, '--json'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (e) {
      // Non-zero exit = risky embed(s) without exemption. Surface them.
      report = e.stdout?.toString() || ''
      const parsed = report ? JSON.parse(report) : { problems: 1, rows: [] }
      const offenders = parsed.rows.filter(r => r.status === 'RISKY')
      throw new Error(
        `RLS embed audit failed — ${parsed.problems} risky embed(s) without ` +
        `exemption.\n\n${offenders
          .map(o => `  ${o.file}:${o.line}  ${o.embed}  — ${o.reason}`)
          .join('\n')}\n\nFix options:\n` +
        '  1. Route through a SECURITY DEFINER RPC.\n' +
        "  2. Loosen the parent table's RLS for the specific columns needed.\n" +
        '  3. If genuinely safe, add an entry to EXEMPT_EMBEDS in\n' +
        '     scripts/audit-embed-rls.mjs explaining why.'
      )
    }
    const parsed = JSON.parse(report)
    expect(parsed.problems).toBe(0)
    // Do NOT assert rows.length > 0: zero embeds is correct here.
  })
})
