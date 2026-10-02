/**
 * Live-DB contract test for the membership flow (Layer 1 + 2).
 *
 * Covers migration 20260813150000_membership_accounts_tiers:
 *   - place_membership is authenticated-only (raises without auth.uid()),
 *     stamps user_id + the ACCOUNT email, prices from membership_tiers, and
 *     leaves starts_at/expires_at NULL (the clock starts at admin approval).
 *   - memberships_owner_select RLS: members read their OWN row; other
 *     users and anon read nothing (rows hold POPIA-sensitive ID numbers).
 *   - admin_update_membership_status / admin_create_membership are granted
 *     to `authenticated` but self-check is_admin() — non-admins must be
 *     rejected (same pattern as admin_update_order_status).
 *   - A second pending application for the same account is rejected.
 *   - place_cod_order (re-created in the same migration, section 7) rejects
 *     member-only products for signed-in callers WITHOUT an active
 *     membership — no order row, no stock movement.
 *
 * REQUIRES migration 20260813150000. This spec was committed BEFORE its
 * migration was pushed, so on top of the key gate it probes membership_tiers at
 * module load. `probeMigration` distinguishes "table genuinely absent" (a clean
 * skip) from "the probe broke" (a LOUD failure) — the old `MIGRATED = !error`
 * form turned a transient network blip into a silent all-green skip of every
 * RLS and admin-authorization assertion below.
 *
 * ISOLATION: the two accounts and the member-only product all carry RUN_TAG, so
 * a concurrent or orphaned vitest run cannot delete them mid-test. afterAll
 * removes everything this run created — including any order, which would
 * otherwise register in the admin dashboard's revenue tiles.
 *
 * Auto-skips unless BOTH VITE_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY
 * are set (service role is required for safe cleanup).
 *
 * How to run (PowerShell):
 *   npx vitest run src/__tests__/membership.contract.test.js
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  anonClient, serviceClient, probeMigration, describeGate,
  testSlug, createTestUser, signInAs, deleteTestUsers, mustSucceed,
} from './helpers/liveFixtures.js'

// Anon has public SELECT on active tiers, so a clean response == applied (an
// empty result would still prove the table exists).
const gate = await probeMigration({
  migration: '20260813150000_membership_accounts_tiers',
  label: 'membership_tiers',
  probe: () => anonClient().from('membership_tiers').select('slug').limit(1),
})
const SKIP = !gate.applied

// Our own member-only product for the place_cod_order gate test.
const TEST_PRODUCT_SLUG = testSlug('members-only')
const TEST_PRODUCT_STOCK = 5

const anon = SKIP ? null : anonClient()
const admin = SKIP ? null : serviceClient()
// Signed in as the applicant in beforeAll — the role real members hold.
const userClient = SKIP ? null : anonClient()
// A SECOND signed-in customer, to prove owner-select doesn't leak across users.
const otherClient = SKIP ? null : anonClient()

// Shared state across the ordered tests.
let testUserId = null
let testUserEmail = null
let otherUserId = null
let otherUserEmail = null
let membershipId = null
let memberProductId = null

const applicationPayload = () => ({
  p_customer: {
    full_name: 'Vitest Member',
    // Deliberately NOT the account email — the server must ignore this and
    // stamp the (verified) account email instead.
    email: 'spoofed+attacker@example.com',
    phone: '0000000000',
    date_of_birth: '1990-01-01',
    id_number: null,
  },
  p_tier: 'daily',
  p_reference: null,
})

describe.skipIf(SKIP)('Membership contract — account-required applications + tiers', () => {
  beforeAll(async () => {
    const prod = mustSucceed('create member-only test product', await admin
      .from('products')
      .insert({
        name: `Vitest Members-Only Product ${TEST_PRODUCT_SLUG}`,
        slug: TEST_PRODUCT_SLUG,
        price: 12000,
        category: 'accessories',
        stock_quantity: TEST_PRODUCT_STOCK,
        is_available: true,
        is_member_only: true,
      })
      .select('id')
      .single())
    memberProductId = prod.id

    const u1 = await createTestUser(admin, 'membership')
    testUserId = u1.id
    testUserEmail = u1.email
    const u2 = await createTestUser(admin, 'membership2')
    otherUserId = u2.id
    otherUserEmail = u2.email

    await signInAs(userClient, testUserEmail)
    await signInAs(otherClient, otherUserEmail)
  })

  afterAll(async () => {
    if (!admin) return
    const emails = [testUserEmail, otherUserEmail].filter(Boolean)
    if (emails.length) {
      await admin.from('memberships').delete().in('email', emails)
      // Should be none — the member-only gate must have blocked it — but a
      // stray test order would land in the admin dashboard's revenue tiles.
      await admin.from('orders').delete().in('customer_email', emails)
    }
    await admin.from('products').delete().eq('slug', TEST_PRODUCT_SLUG)
    await deleteTestUsers(admin, testUserId, otherUserId)
  })

  it('POSITIVE: anon reads the three seeded active tiers (public pricing page)', async () => {
    const { data, error } = await anon
      .from('membership_tiers')
      .select('slug, price_cents, duration_days, is_active')
      .order('sort_order')
    expect(error).toBeNull()
    const slugs = (data ?? []).map((t) => t.slug)
    expect(slugs).toEqual(expect.arrayContaining(['daily', 'weekly', 'monthly']))
    const daily = data.find((t) => t.slug === 'daily')
    expect(daily.price_cents).toBe(1000)
    expect(daily.duration_days).toBe(1)
  })

  it('NEGATIVE: anon can no longer call place_membership (free-minting hole closed)', async () => {
    const { data, error } = await anon.rpc('place_membership', applicationPayload())
    // Either the revoked grant blocks the call or the auth.uid() check raises —
    // the only unacceptable outcome is a membership row being created.
    expect(error).not.toBeNull()
    expect(data).toBeNull()

    const { data: rows } = await admin
      .from('memberships')
      .select('id')
      .eq('email', 'spoofed+attacker@example.com')
    expect(rows ?? []).toHaveLength(0)
  })

  it('POSITIVE: a signed-in customer places a pending application stamped with user_id + ACCOUNT email, clock NOT started', async () => {
    const { data, error } = await userClient.rpc('place_membership', applicationPayload())
    expect(error).toBeNull()
    expect(data).toBeTruthy()
    expect(data.status).toBe('pending')
    expect(data.tier).toBe('daily')
    expect(data.amount).toBe(1000)
    membershipId = data.id

    // Ownership + email-lock + deferred-clock contract, verified with the
    // service-role client.
    const { data: row } = await admin
      .from('memberships')
      .select('user_id, email, tier_id, status, starts_at, expires_at, approved_at')
      .eq('id', membershipId)
      .single()
    expect(row?.user_id).toBe(testUserId)
    expect(row?.email).toBe(testUserEmail)
    expect(row?.tier_id).toBeTruthy()
    expect(row?.status).toBe('pending')
    expect(row?.starts_at).toBeNull()
    expect(row?.expires_at).toBeNull()
    expect(row?.approved_at).toBeNull()
  })

  it('POSITIVE: the member reads their own membership via RLS (memberships_owner_select)', async () => {
    expect(membershipId).toBeTruthy()
    const { data, error } = await userClient
      .from('memberships')
      .select('id, tier, status, amount')
      .eq('id', membershipId)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data[0].status).toBe('pending')
  })

  it('NEGATIVE: another signed-in user cannot read that membership (PII: SA ID numbers)', async () => {
    expect(membershipId).toBeTruthy()
    const { data, error } = await otherClient
      .from('memberships')
      .select('id_number, email')
      .eq('id', membershipId)
    // Tolerate error or empty — the only failure that matters is leaked rows.
    expect(error != null || (data?.length ?? 0) === 0).toBe(true)
  })

  it('NEGATIVE: anon cannot read any membership rows', async () => {
    const { data, error } = await anon
      .from('memberships')
      .select('id_number, email')
      .limit(5)
    expect(error != null || (data?.length ?? 0) === 0).toBe(true)
  })

  it('NEGATIVE: duplicate pending application for the same account is rejected', async () => {
    expect(membershipId).toBeTruthy()
    const { data, error } = await userClient.rpc('place_membership', applicationPayload())
    expect(error).not.toBeNull()
    expect(data).toBeNull()

    // Still exactly one row for this account.
    const { data: rows } = await admin
      .from('memberships')
      .select('id')
      .eq('user_id', testUserId)
    expect(rows).toHaveLength(1)
  })

  // Asserts the Part-7 addition to place_cod_order in migration
  // 20260813150000: a member-only product requires an ACTIVE membership.
  // The migration ships as one unit, so the membership_tiers probe that
  // gates this suite also guarantees the re-created place_cod_order is live.
  it('NEGATIVE: place_cod_order rejects a member-only product for a non-member — no order, no stock change', async () => {
    expect(memberProductId).toBeTruthy()
    // By this point the test user holds only a PENDING membership (placed
    // above) — pending must NOT unlock member-only products; only
    // status='active' with expires_at in the future does.
    const { data, error } = await userClient.rpc('place_cod_order', {
      p_customer: {
        name: 'Vitest Member',
        phone: '0000000000',
        street: '1 Test St',
        city: 'Boksburg',
        province: 'Gauteng',
        postalCode: '1459',
      },
      p_items: [{ id: memberProductId, quantity: 1 }],
      p_payment_method: 'cash_on_delivery',
    })
    expect(error).not.toBeNull()
    expect(data).toBeNull()
    expect(error.message).toMatch(/members only/i)

    // The whole transaction rolled back: no order row for this account and
    // the product's stock is untouched.
    const { data: orders } = await admin
      .from('orders')
      .select('id')
      .eq('customer_email', testUserEmail)
    expect(orders ?? []).toHaveLength(0)

    const { data: prod } = await admin
      .from('products')
      .select('stock_quantity')
      .eq('id', memberProductId)
      .single()
    expect(prod?.stock_quantity).toBe(TEST_PRODUCT_STOCK)
  })

  it('NEGATIVE: an authenticated NON-admin cannot call admin_update_membership_status', async () => {
    expect(membershipId).toBeTruthy()
    // The customer holds the `authenticated` role, so the grant alone doesn't
    // protect this RPC — is_admin() inside it must raise 'Not authorized'.
    const { data, error } = await userClient.rpc('admin_update_membership_status', {
      p_id: membershipId,
      p_status: 'active',
    })
    expect(error).not.toBeNull()
    expect(data).toBeNull()

    // Confirm nothing changed under the hood — still pending, clock stopped.
    const { data: after } = await admin
      .from('memberships')
      .select('status, starts_at, expires_at, approved_at')
      .eq('id', membershipId)
      .single()
    expect(after?.status).toBe('pending')
    expect(after?.starts_at).toBeNull()
    expect(after?.expires_at).toBeNull()
    expect(after?.approved_at).toBeNull()
  })

  it('NEGATIVE: an authenticated NON-admin cannot call admin_create_membership', async () => {
    const { data, error } = await userClient.rpc('admin_create_membership', {
      p_customer: {
        full_name: 'Walkin Vitest',
        email: otherUserEmail,
        phone: '0000000000',
        date_of_birth: '1990-01-01',
      },
      p_tier_slug: 'daily',
    })
    expect(error).not.toBeNull()
    expect(data).toBeNull()

    const { data: rows } = await admin
      .from('memberships')
      .select('id')
      .eq('email', otherUserEmail)
    expect(rows ?? []).toHaveLength(0)
  })
})

describeGate('Membership contract', gate)
