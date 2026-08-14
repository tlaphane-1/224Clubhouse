/**
 * Live-DB contract test for event reservations (Layer 1 + 2).
 *
 * Covers migration 20260814102000_event_reservations:
 *   - reserve_event_seats is authenticated-only (anon is revoked / raises),
 *     stamps user_id + the ACCOUNT email (the caller's email is ignored) and
 *     snapshots total_cents from the event's ticket_price.
 *   - event_reservations_owner_select RLS: a guest reads their OWN reservation;
 *     another signed-in user and anon read nothing (name/email/phone are
 *     personal data — POPIA).
 *   - A duplicate live reservation for the same event is rejected.
 *   - A past event cannot be reserved.
 *   - A members-only event rejects a caller without an ACTIVE membership.
 *   - capacity (added to events in the same migration) is enforced.
 *   - admin_update_reservation_status is granted to `authenticated` but
 *     self-checks is_admin() — a customer must be rejected.
 *
 * REQUIRES migration 20260814102000 to be applied. Like the membership spec,
 * this is committed BEFORE its migration is pushed, so on top of the usual key
 * gate it probes the event_seats_remaining computed column with the anon
 * client at module load: no column, no live suite (it auto-skips with a banner
 * saying why) instead of hard-failing.
 *
 * Because it MUTATES (creates two users + three events + reservation rows),
 * afterAll cleans up with the service-role client. Idempotent — leftovers are
 * purged first. Deleting the test events cascades their reservations.
 *
 * Auto-skips unless BOTH VITE_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY
 * are set (service role is required for safe cleanup).
 *
 * How to run (PowerShell):
 *   npx vitest run src/__tests__/eventReservations.contract.test.js
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const URL =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  'https://aogdkqczvlffgydgxsmz.supabase.co'
const ANON = process.env.VITE_SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
const KEYS_MISSING = !ANON || !SERVICE

// Migration probe: event_seats_remaining() only exists once 20260814102000 is
// applied. Anon has public SELECT on events, so "no error" == applied (an
// empty result would still prove the function resolves).
let MIGRATED = false
if (!KEYS_MISSING) {
  const probe = createClient(URL, ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error } = await probe
    .from('events')
    .select('id, seats_remaining:event_seats_remaining')
    .limit(1)
  MIGRATED = !error
}
const SKIP = KEYS_MISSING || !MIGRATED

// Clearly-marked test identities so cleanup can target exactly our rows.
const TEST_EMAIL = 'vitest+eventres@example.com'
const TEST_EMAIL_2 = 'vitest+eventres2@example.com'
const TEST_PASSWORD = 'vitest-evt-7k2!Local'
const EVENT_PREFIX = 'Vitest Event —'
const TICKET_PRICE = 15000 // R150.00 in cents

const anon = SKIP
  ? null
  : createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } })
const admin = SKIP
  ? null
  : createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })
// Signed in as the guest in beforeAll — the role real customers hold.
const userClient = SKIP
  ? null
  : createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } })
// A SECOND signed-in customer, to prove owner-select doesn't leak across users.
const otherClient = SKIP
  ? null
  : createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } })

// Shared state across the ordered tests.
let testUserId = null
let otherUserId = null
let openEventId = null
let membersEventId = null
let pastEventId = null
let cappedEventId = null
let reservationId = null

function isoDate(offsetDays) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return d.toISOString().split('T')[0]
}

async function purgeTestEvents() {
  // Reservations go with the events (on delete cascade); belt-and-braces for
  // any row whose event was already removed by a half-finished run.
  await admin.from('event_reservations').delete().in('email', [TEST_EMAIL, TEST_EMAIL_2])
  await admin.from('events').delete().like('title', `${EVENT_PREFIX}%`)
}

async function purgeTestUsers() {
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  for (const u of data?.users ?? []) {
    if (u.email === TEST_EMAIL || u.email === TEST_EMAIL_2) {
      await admin.auth.admin.deleteUser(u.id)
    }
  }
}

async function createEvent(fields) {
  const { data, error } = await admin
    .from('events')
    .insert({ ticket_price: TICKET_PRICE, ...fields })
    .select('id')
    .single()
  expect(error).toBeNull()
  return data.id
}

const customer = () => ({
  name: 'Vitest Guest',
  phone: '0000000000',
  // Deliberately NOT the account email — the server must ignore this and
  // stamp the (verified) account email instead.
  email: 'spoofed+attacker@example.com',
})

describe.skipIf(SKIP)('Event reservations contract — reserve online, pay at the door', () => {
  beforeAll(async () => {
    await purgeTestEvents()
    await purgeTestUsers()

    openEventId = await createEvent({
      title: `${EVENT_PREFIX} Open Night`, date: isoDate(14), is_members_only: false,
    })
    membersEventId = await createEvent({
      title: `${EVENT_PREFIX} Members Night`, date: isoDate(21), is_members_only: true,
    })
    pastEventId = await createEvent({
      title: `${EVENT_PREFIX} Last Month`, date: isoDate(-30), is_members_only: false,
    })
    cappedEventId = await createEvent({
      title: `${EVENT_PREFIX} Capped Night`, date: isoDate(28), is_members_only: false, capacity: 2,
    })

    // Confirmed customer accounts (email confirmation is ON in this project,
    // so bypass it with the admin API rather than clicking a link).
    const { data: u1, error: e1 } = await admin.auth.admin.createUser({
      email: TEST_EMAIL, password: TEST_PASSWORD, email_confirm: true,
    })
    expect(e1).toBeNull()
    testUserId = u1.user.id

    const { data: u2, error: e2 } = await admin.auth.admin.createUser({
      email: TEST_EMAIL_2, password: TEST_PASSWORD, email_confirm: true,
    })
    expect(e2).toBeNull()
    otherUserId = u2.user.id

    const { error: s1 } = await userClient.auth.signInWithPassword({
      email: TEST_EMAIL, password: TEST_PASSWORD,
    })
    expect(s1).toBeNull()
    const { error: s2 } = await otherClient.auth.signInWithPassword({
      email: TEST_EMAIL_2, password: TEST_PASSWORD,
    })
    expect(s2).toBeNull()
  })

  afterAll(async () => {
    if (!admin) return
    await purgeTestEvents()
    if (testUserId) await admin.auth.admin.deleteUser(testUserId)
    if (otherUserId) await admin.auth.admin.deleteUser(otherUserId)
  })

  it('NEGATIVE: anon cannot call reserve_event_seats (no free-minting reservations)', async () => {
    const { data, error } = await anon.rpc('reserve_event_seats', {
      p_event_id: openEventId, p_quantity: 1, p_customer: customer(),
    })
    // Either the revoked grant blocks the call or the auth.uid() check raises —
    // the only unacceptable outcome is a reservation row being created.
    expect(error).not.toBeNull()
    expect(data).toBeNull()

    const { data: rows } = await admin
      .from('event_reservations')
      .select('id')
      .eq('event_id', openEventId)
    expect(rows ?? []).toHaveLength(0)
  })

  it('POSITIVE: a signed-in guest reserves — row carries user_id + ACCOUNT email and a priced snapshot', async () => {
    const { data, error } = await userClient.rpc('reserve_event_seats', {
      p_event_id: openEventId, p_quantity: 2, p_customer: customer(),
    })
    expect(error).toBeNull()
    expect(data).toBeTruthy()
    expect(data.status).toBe('reserved')
    expect(data.quantity).toBe(2)
    expect(data.total_cents).toBe(TICKET_PRICE * 2)
    reservationId = data.id

    const { data: row } = await admin
      .from('event_reservations')
      .select('user_id, email, name, phone, quantity, status, total_cents, status_history')
      .eq('id', reservationId)
      .single()
    expect(row?.user_id).toBe(testUserId)
    expect(row?.email).toBe(TEST_EMAIL) // the spoofed address was ignored
    expect(row?.quantity).toBe(2)
    expect(row?.status).toBe('reserved')
    expect(row?.total_cents).toBe(TICKET_PRICE * 2)
    expect(row?.status_history?.[0]?.status).toBe('reserved')
  })

  it('POSITIVE: the guest reads their own reservation via RLS (event_reservations_owner_select)', async () => {
    expect(reservationId).toBeTruthy()
    const { data, error } = await userClient
      .from('event_reservations')
      .select('id, event_id, quantity, status')
      .eq('id', reservationId)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data[0].status).toBe('reserved')
  })

  it('NEGATIVE: another signed-in user cannot read that reservation (PII: name, email, phone)', async () => {
    expect(reservationId).toBeTruthy()
    const { data, error } = await otherClient
      .from('event_reservations')
      .select('name, email, phone')
      .eq('id', reservationId)
    // Tolerate error or empty — the only failure that matters is leaked rows.
    expect(error != null || (data?.length ?? 0) === 0).toBe(true)
  })

  it('NEGATIVE: anon cannot read any reservation rows', async () => {
    const { data, error } = await anon
      .from('event_reservations')
      .select('name, email, phone')
      .limit(5)
    expect(error != null || (data?.length ?? 0) === 0).toBe(true)
  })

  it('NEGATIVE: a duplicate reservation for the same event is rejected', async () => {
    const { data, error } = await userClient.rpc('reserve_event_seats', {
      p_event_id: openEventId, p_quantity: 1, p_customer: customer(),
    })
    expect(error).not.toBeNull()
    expect(data).toBeNull()

    // Still exactly one row for this guest on this event.
    const { data: rows } = await admin
      .from('event_reservations')
      .select('id')
      .eq('event_id', openEventId)
      .eq('user_id', testUserId)
    expect(rows).toHaveLength(1)
  })

  it('NEGATIVE: a past event cannot be reserved', async () => {
    const { data, error } = await userClient.rpc('reserve_event_seats', {
      p_event_id: pastEventId, p_quantity: 1, p_customer: customer(),
    })
    expect(error).not.toBeNull()
    expect(data).toBeNull()
    expect(error.message).toMatch(/already taken place/i)

    const { data: rows } = await admin
      .from('event_reservations')
      .select('id')
      .eq('event_id', pastEventId)
    expect(rows ?? []).toHaveLength(0)
  })

  it('NEGATIVE: a non-member cannot reserve a members-only event', async () => {
    // This account holds no membership at all, which is exactly the state the
    // gate must reject (place_cod_order applies the same predicate to
    // is_member_only products).
    const { data, error } = await userClient.rpc('reserve_event_seats', {
      p_event_id: membersEventId, p_quantity: 1, p_customer: customer(),
    })
    expect(error).not.toBeNull()
    expect(data).toBeNull()
    expect(error.message).toMatch(/members only/i)

    const { data: rows } = await admin
      .from('event_reservations')
      .select('id')
      .eq('event_id', membersEventId)
    expect(rows ?? []).toHaveLength(0)
  })

  it('NEGATIVE: capacity is enforced — an over-capacity request is refused', async () => {
    // capacity 2: asking for 3 must fail outright...
    const { data: tooMany, error: capErr } = await userClient.rpc('reserve_event_seats', {
      p_event_id: cappedEventId, p_quantity: 3, p_customer: customer(),
    })
    expect(capErr).not.toBeNull()
    expect(tooMany).toBeNull()

    // ...2 fits...
    const { error: okErr } = await userClient.rpc('reserve_event_seats', {
      p_event_id: cappedEventId, p_quantity: 2, p_customer: customer(),
    })
    expect(okErr).toBeNull()

    // ...and the event is now full for everyone else.
    const { data: after, error: fullErr } = await otherClient.rpc('reserve_event_seats', {
      p_event_id: cappedEventId, p_quantity: 1, p_customer: customer(),
    })
    expect(fullErr).not.toBeNull()
    expect(after).toBeNull()
    expect(fullErr.message).toMatch(/fully booked/i)

    // The computed column agrees: zero left.
    const { data: ev } = await anon
      .from('events')
      .select('seats_remaining:event_seats_remaining')
      .eq('id', cappedEventId)
      .single()
    expect(ev?.seats_remaining).toBe(0)
  })

  it('NEGATIVE: an authenticated NON-admin cannot call admin_update_reservation_status', async () => {
    expect(reservationId).toBeTruthy()
    // The customer holds the `authenticated` role, so the grant alone doesn't
    // protect this RPC — is_admin() inside it must raise 'Not authorized'.
    const { data, error } = await userClient.rpc('admin_update_reservation_status', {
      p_id: reservationId, p_status: 'attended',
    })
    expect(error).not.toBeNull()
    expect(data).toBeNull()

    const { data: after } = await admin
      .from('event_reservations')
      .select('status')
      .eq('id', reservationId)
      .single()
    expect(after?.status).toBe('reserved')
  })
})

describe.skipIf(!SKIP)(
  KEYS_MISSING
    ? 'Event reservations contract skipped (need VITE_SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY)'
    : 'Event reservations contract skipped (migration 20260814102000_event_reservations not applied — run `supabase db push`)',
  () => {
    it('reminds devs how to enable the event reservations contract test', () => {
      expect(true).toBe(true)
    })
  },
)
