/**
 * Vitest setup file: load .env.local into process.env at runtime.
 *
 * The contract tests read secrets (SUPABASE_SERVICE_ROLE_KEY,
 * VITE_SUPABASE_ANON_KEY, VITE_SUPABASE_URL) from process.env. Vite's
 * import.meta.env machinery isn't available in the `node` test
 * environment, so we parse .env.local ourselves — no dotenv dependency.
 *
 * Parser shape is copied from scripts/seed.js (lines ~14-22): split on
 * '=', skip comments/blank lines, keep the first '=' as the separator.
 * Existing process.env values win (so CI / shell exports override the
 * file), and a missing .env.local is non-fatal — the tests then simply
 * auto-skip because the keys aren't present.
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dirname, '../.env.local')

try {
  const envContent = readFileSync(envPath, 'utf-8')
  const env = Object.fromEntries(
    envContent.split('\n')
      .filter(l => l.includes('=') && !l.trim().startsWith('#'))
      .map(l => l.split('=').map(s => s.trim()))
      .map(([k, ...v]) => [k, v.join('=')])
  )
  for (const [k, v] of Object.entries(env)) {
    if (process.env[k] === undefined) process.env[k] = v
  }
} catch {
  // No .env.local — fine. Layer 1 & 2 will auto-skip without keys.
}
