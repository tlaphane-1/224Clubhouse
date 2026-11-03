/**
 * Run vitest against the LOCAL Supabase stack (Docker), never production.
 *
 *   npm run test:local -- <vitest args>
 *   npm run test:local -- src/__tests__/*.contract.test.js
 *
 * Why this exists: phase 2 of the multi-store work changes the schema, and
 * migrations must be rehearsed on a throwaway database before they touch the
 * live project. `supabase start` rebuilds the schema from supabase/migrations/,
 * and this runner points the live-DB contract suites at it.
 *
 * What it does:
 *   1. Reads the API URL and keys from `supabase status -o json`.
 *   2. Refuses to continue unless the API host is 127.0.0.1 or localhost
 *      (exit 2) -- the suites create and delete rows, so a mis-pointed run
 *      must never reach the live project.
 *   3. Unschedules the pg_cron jobs that call production Edge Functions over
 *      HTTP, so the local stack never reaches out to production. Idempotent.
 *   4. Runs `vitest run <args>` with the env below and exits with its code.
 *
 * test/loadEnv.mjs only fills env vars that are still undefined, so the values
 * set here win over anything in .env.local.
 *
 * Keys are never printed: only the API host and which keys were found.
 */
import { spawnSync } from 'node:child_process'
import { globSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost'])
// Must match project_id in supabase/config.toml: the CLI names the db container
// supabase_db_<project_id>.
const DB_CONTAINER = 'supabase_db_224clubhouse'
// The two jobs that POST to production Edge Functions (see the
// abandoned_cart_reminders and admin_daily_summary migrations).
const HTTP_CRON_JOBS = ['send-cart-reminders', 'send-daily-summary']
// Override when `supabase` on PATH is not directly executable by node (e.g. a
// Windows shim); set SUPABASE_BIN to the full path of a working CLI binary.
const SUPABASE_BIN = process.env.SUPABASE_BIN || 'supabase'

function fail(message) {
  console.error(`test:local: ${message}`)
  process.exit(2)
}

function readStatus() {
  const res = spawnSync(SUPABASE_BIN, ['status', '-o', 'json'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  if (res.error || res.status !== 0) {
    fail('the local Supabase stack is not running. Start it with `supabase start`.')
  }
  try {
    // The CLI may print update notices around the JSON; take the object only.
    const text = res.stdout
    return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
  } catch {
    fail('could not parse `supabase status -o json`.')
  }
}

function localEnv(status) {
  let host
  try {
    host = new URL(status.API_URL).hostname
  } catch {
    fail('`supabase status` returned no usable API_URL.')
  }
  if (!LOCAL_HOSTS.has(host)) {
    fail(`refusing to run: API host "${host}" is not local (127.0.0.1 / localhost).`)
  }
  const anon = status.ANON_KEY
  const service = status.SERVICE_ROLE_KEY
  if (!anon || !service) {
    fail('`supabase status` is missing ANON_KEY and/or SERVICE_ROLE_KEY.')
  }
  console.log(`test:local: API host ${host}; anon key found; service-role key found`)
  return {
    SUPABASE_URL: status.API_URL,
    VITE_SUPABASE_URL: status.API_URL,
    VITE_SUPABASE_ANON_KEY: anon,
    SUPABASE_SERVICE_ROLE_KEY: service,
  }
}

function unscheduleHttpCronJobs() {
  const names = HTTP_CRON_JOBS.map((n) => `'${n}'`).join(', ')
  const sql = `select cron.unschedule(jobid) from cron.job where jobname in (${names});`
  const res = spawnSync(
    'docker',
    ['exec', DB_CONTAINER, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', sql],
    { encoding: 'utf8' },
  )
  if (res.error || res.status !== 0) {
    fail(`could not unschedule the http cron jobs in ${DB_CONTAINER}: ${res.stderr || res.error}`)
  }
}

// npm runs scripts through cmd.exe on Windows, which does not expand globs,
// and vitest treats its args as substring filters rather than globs.
function expandGlobs(args) {
  return args.flatMap((arg) => {
    if (arg.startsWith('-') || !/[*?]/.test(arg)) return [arg]
    const matches = globSync(arg, { cwd: ROOT }).map((p) => p.replaceAll('\\', '/')).sort()
    if (matches.length === 0) fail(`no files match "${arg}".`)
    return matches
  })
}

const env = localEnv(readStatus())
unscheduleHttpCronJobs()

const vitestBin = resolve(ROOT, 'node_modules/vitest/vitest.mjs')
// The local stack serves https with a self-signed certificate ([api.tls] in
// supabase/config.toml), which the contract suites need (they assert https
// signed URLs). NODE_TLS_REJECT_UNAUTHORIZED=0 covers that self-signed local
// cert only: it is set here, after localEnv() has confirmed the API host is
// 127.0.0.1/localhost, and only in the child's env, never for any other run.
// SUPABASE_LOCAL_STACK=1 tells suites they are on this throwaway stack, so
// tests that only make sense locally (public signUp with email confirmation
// off, which on production would mail a real confirmation) can run here and
// skip everywhere else.
const run = spawnSync(
  process.execPath,
  [vitestBin, 'run', ...expandGlobs(process.argv.slice(2))],
  {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...env, NODE_TLS_REJECT_UNAUTHORIZED: '0', SUPABASE_LOCAL_STACK: '1' },
  },
)
process.exit(run.status ?? 1)
