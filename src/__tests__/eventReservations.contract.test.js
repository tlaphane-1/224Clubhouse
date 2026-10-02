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
 * REQUIRES migration 20260814102000. Committed before its migration was pushed,
 * so it probes the event_seats_remaining computed column at module load.
 * `probeMigration` separates "column genuinely absent" (a clean skip) from "the
 * probe broke" (a LOUD failure) — the old `MIGRATED = !error` form let a
 * transient blip skip the whole suite while the run stayed green.
 *
 * ISOLATION: the two accounts and all four events carry RUN_TAG, so a
 * concurrent or orphaned vitest run cannot delete them mid-test. This suite was
 * the worst offender before: its old `beforeAll` ran
 * `DELETE FROM events WHERE title LIKE 'Vitest Event —%'`, which wiped a
 * parallel run's events and cascaded away the reservations it was asserting on.
 *
 * afterAll deletes the events it made (reservations cascade).
 *
 * Auto-skips unless BOTH VITE_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY
 * are set (service role is required for safe cleanup).
 *
 * How to run (PowerShell):
 *   npx vitest run src/__tests__/eventReservations.contract.test.js
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  anonClient, serviceClient, probeMigration, describeGate,
  RUN_TAG, EVENT_TITLE_PREFIX, testEventTitle,
  createTestUser, signInAs, deleteTestUsers, mustSucceed,
} from './helpers/liveFixtures.js'

// Anon has public SELECT on events, so a clean response == applied (an empty
// result would still prove the computed column resolves).
const gate = await probeMigration({
  migration: '20260814102000_event_reservations',
  label: 'event_seats_remaining',
  probe: () => anonClient()
    .from('events')
    .select('id, seats_remaining:event_seats_remaining')
    .limit(1),
})
const SKIP = !gate.applied

const TICKET_PRICE = 15000 // R150.00 in cents
// Every event this run creates starts with this, and nothing else does.
const MY_EVENTS = `${EVENT_TITLE_PREFIX}${RUN_TAG} —%`

const anon = SKIP ? null : anonClient()
const admin = SKIP ? null : serviceClient()
// Signed in as the guest in beforeAll — the role real customers hold.
const userClient = SKIP ? null : anonClient()
// A SECOND signed-in customer, to prove owner-select doesn't leak across users.
const otherClient = SKIP ? null : anonClient()

// Shared state across the ordered tests.
let testUserId = null
let testUserEmail = null
let otherUserId = null
let otherUserEmail = null
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

async function createEvent(label, fields) {
  const row = mustSucceed(`create event "${label}"`, await admin
    .from('events')
    .insert({ ticket_price: TICKET_PRICE, title: testEventTitle(label), ...fields })
    .select('id')
    .single())
  return row.id
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
    openEventId = await createEvent('Open Night', { date: isoDate(14), is_members_only: false })
    membersEventId = await createEvent('Members Night', { date: isoDate(21), is_members_only: true })
    pastEventId = await createEvent('Last Month', { date: isoDate(-30), is_members_only: false })
    cappedEventId = await createEvent('Capped Night', { date: isoDate(28), is_members_only: false, capacity: 2 })

    const u1 = await createTestUser(admin, 'eventres')
    testUserId = u1.id
    testUserEmail = u1.email
    const u2 = await createTestUser(admin, 'eventres2')
    otherUserId = u2.id
    otherUserEmail = u2.email

    await signInAs(userClient, testUserEmail)
    await signInAs(otherClient, otherUserEmail)
  })

  afterAll(async () => {
    if (!admin) return
    const emails = [testUserEmail, otherUserEmail].filter(Boolean)
    // Reservations go with the events (on delete cascade); the explicit delete
    // is belt-and-braces for a row whose event insert half-finished.
    if (emails.length) await admin.from('event_reservations').delete().in('email', emails)
    await admin.from('events').delete().like('title', MY_EVENTS)
    await deleteTestUsers(admin, testUserId, otherUserId)
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
    expect(row?.email).toBe(testUserEmail) // the spoofed address was ignored
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

describeGate('Event reservations contract', gate)
