/**
 * provision-admin.mjs  (one-off, service-role — bypasses RLS)
 *
 * 1. Lists existing auth users (email + id) so we can see current state.
 * 2. Ensures an admin auth user exists with email ADMIN_EMAIL and a known,
 *    strong password (creates it, or resets the password if it already exists).
 *    The user is created email-confirmed so it can log in immediately.
 *
 * The email matches the seed in migration 20260604120000_admin_authorization.sql,
 * so after this runs and the migration is pushed, that user becomes a real admin.
 *
 * Run: node scripts/provision-admin.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { randomBytes } from 'crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))

const envPath = resolve(__dirname, '../.env.local')
const envContent = readFileSync(envPath, 'utf-8')
const env = Object.fromEntries(
  envContent.split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => l.split('=').map(s => s.trim()))
    .map(([k, ...v]) => [k, v.join('=')])
)

const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const ADMIN_EMAIL = 'admin@224clubhouse.co.za'
// Strong password: prefix for readability + 9 random bytes (72 bits) of entropy.
const PASSWORD = 'Club224!' + randomBytes(9).toString('base64url')

async function main() {
  // 1. List existing users
  const { data: list, error: listErr } = await supabase.auth.admin.listUsers({ perPage: 1000 })
  if (listErr) throw listErr
  console.log(`\n=== Existing auth users (${list.users.length}) ===`)
  for (const u of list.users) {
    console.log(`  ${u.email}  |  id=${u.id}  |  confirmed=${!!u.email_confirmed_at}  |  created=${u.created_at}`)
  }

  // 2. Ensure ADMIN_EMAIL exists with a known password
  const existing = list.users.find(u => (u.email || '').toLowerCase() === ADMIN_EMAIL.toLowerCase())

  let action, userId
  if (existing) {
    const { data, error } = await supabase.auth.admin.updateUserById(existing.id, {
      password: PASSWORD,
      email_confirm: true,
    })
    if (error) throw error
    action = 'PASSWORD RESET on existing user'
    userId = data.user.id
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email: ADMIN_EMAIL,
      password: PASSWORD,
      email_confirm: true,
    })
    if (error) throw error
    action = 'CREATED new user'
    userId = data.user.id
  }

  console.log(`\n=== Admin provisioned ===`)
  console.log(`  action:   ${action}`)
  console.log(`  email:    ${ADMIN_EMAIL}`)
  console.log(`  password: ${PASSWORD}`)
  console.log(`  user id:  ${userId}`)
  console.log(`\nNext: apply the migration (supabase db push) so this user is seeded into admin_users.`)
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
