/**
 * verify-admin.mjs — proves the admin login works end-to-end, the way the live
 * site does: sign in with the ANON key, then call rpc('is_admin').
 * Run: node scripts/verify-admin.mjs <password>
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const env = Object.fromEntries(
  readFileSync(resolve(__dirname, '../.env.local'), 'utf-8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => l.split('=').map(s => s.trim()))
    .map(([k, ...v]) => [k, v.join('=')])
)

const EMAIL = 'admin@224clubhouse.co.za'
const PASSWORD = process.argv[2]
if (!PASSWORD) { console.error('Usage: node scripts/verify-admin.mjs <password>'); process.exit(1) }

// 1. Service-role: confirm the admin_users row exists
const svc = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const { data: rows, error: rowsErr } = await svc.from('admin_users').select('*')
if (rowsErr) throw rowsErr
console.log(`admin_users rows: ${rows.length}`)
rows.forEach(r => console.log(`  ${r.email}  id=${r.id}`))

// 2. Anon: real login flow (this is what AuthContext does in the browser)
const anon = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
const { data: signIn, error: signErr } = await anon.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
console.log(`\nsignIn: ${signErr ? 'FAILED — ' + signErr.message : 'OK (' + signIn.user.email + ')'}`)
if (signErr) process.exit(1)

const { data: isAdmin, error: rpcErr } = await anon.rpc('is_admin')
console.log(`rpc('is_admin'): ${rpcErr ? 'ERROR — ' + rpcErr.message : isAdmin}`)
console.log(`\n${!rpcErr && isAdmin ? '✅ ADMIN LOGIN WORKS END-TO-END' : '❌ NOT WORKING'}`)
