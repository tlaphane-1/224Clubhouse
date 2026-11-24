/**
 * Live-DB contract test for 20261125100000_staff_shifts.
 *
 * Staff (the shared counter tablet's account) clock in with a selfie:
 *   POSITIVE — an admin adds staff by email; staff upload a selfie into their
 *              own folder and start/end a shift on the server clock.
 *   NEGATIVE — customers can't start shifts or upload selfies; nobody can
 *              start twice, use someone else's folder, or end a shift they
 *              don't have; selfies are private to the person and the admin.
 *   NEGATIVE — a vitest-b staff member is not staff in 224.
 *
 *   npm run test:local -- src/__tests__/staffShifts.contract.test.js
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  serviceClient, probeMigration, describeGate, mustSucceed, ensureTestTenant, TEST_TENANT,
  createTenantUser, signInClient, deleteTestUsers, TEST_PASSWORD,
} from './helpers/liveFixtures.js'

const gate = await probeMigration({
  migration: '20261125100000_staff_shifts',
  label: 'staff_members',
  probe: () => serviceClient().from('staff_members').select('user_id').limit(1),
})
const SKIP = !gate.applied
describeGate('Staff shifts contract', gate)

const BUCKET = 'shift-selfies'
// Smallest valid JPEG-ish payload; the bucket checks the declared mime type.
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9])

describe.skipIf(SKIP)('Staff shifts contract', () => {
  const admin = SKIP ? null : serviceClient()
  const u = {} // label -> { id, email }
  const c = {} // label -> signed-in client
  const paths = []

  const path = (user, name = `${Date.now()}.jpg`) => `${TEST_TENANT}/${user.id}/${name}`
  async function upload(client, p) {
    const res = await client.storage.from(BUCKET).upload(p, JPEG, { contentType: 'image/jpeg' })
    if (!res.error) paths.push(p)
    return res
  }

  beforeAll(async () => {
    await ensureTestTenant(admin)
    for (const label of ['boss', 'cashier', 'customer']) {
      u[label] = await createTenantUser(admin, `staff-${label}`, TEST_TENANT)
    }
    mustSucceed('grant admin', await admin.from('admin_users')
      .insert({ id: u.boss.id, email: u.boss.email, tenant: TEST_TENANT }))
    for (const label of Object.keys(u)) {
      c[label] = await signInClient(u[label].email, TEST_PASSWORD, { tenant: TEST_TENANT })
    }
  })

  afterAll(async () => {
    if (!admin) return
    const ids = Object.values(u).map(x => x.id)
    await admin.from('shifts').delete().in('user_id', ids)
    await admin.from('staff_members').delete().in('user_id', ids)
    await admin.from('drivers').delete().in('user_id', ids)
    await admin.from('admin_users').delete().in('id', ids)
    if (paths.length) await admin.storage.from(BUCKET).remove(paths)
    await deleteTestUsers(admin, ...ids)
  })

  it('admin_add_staff refuses an email with no account in this store', async () => {
    const { error } = await c.boss.rpc('admin_add_staff', {
      p_email: 'nobody-here@example.com', p_full_name: 'Nobody',
    })
    expect(error?.message).toMatch(/No account with that email/)
  })

  it('a customer cannot add staff', async () => {
    const { error } = await c.customer.rpc('admin_add_staff', {
      p_email: u.customer.email, p_full_name: 'Self Promoted',
    })
    expect(error?.message).toMatch(/Not authorized/)
  })

  it('admin adds a staff member by email; is_staff() becomes true for them', async () => {
    const before = await c.cashier.rpc('is_staff')
    expect(before.data).toBe(false)
    const { error } = await c.boss.rpc('admin_add_staff', {
      p_email: u.cashier.email.toUpperCase(), p_full_name: 'Vitest Cashier',
    })
    expect(error).toBeNull()
    const after = await c.cashier.rpc('is_staff')
    expect(after.data).toBe(true)
  })

  it('a customer is not staff: start_shift refused and selfie upload refused', async () => {
    expect((await c.customer.rpc('is_staff')).data).toBe(false)
    const up = await upload(c.customer, path(u.customer))
    expect(up.error).not.toBeNull()
    const { error } = await c.customer.rpc('start_shift', { p_selfie_path: path(u.customer) })
    expect(error?.message).toMatch(/Not authorized/)
  })

  it('staff cannot upload into another person\'s folder, nor start with it', async () => {
    const other = path(u.boss)
    expect((await upload(c.cashier, other)).error).not.toBeNull()
    const { error } = await c.cashier.rpc('start_shift', { p_selfie_path: other })
    expect(error?.message).toMatch(/Invalid selfie path/)
  })

  it('end_shift with no open shift is refused', async () => {
    const { error } = await c.cashier.rpc('end_shift')
    expect(error?.message).toMatch(/No open shift/)
  })

  it('staff upload a selfie and start a shift on the server clock; a second start is refused', async () => {
    const p = path(u.cashier)
    expect((await upload(c.cashier, p)).error).toBeNull()
    const start = await c.cashier.rpc('start_shift', { p_selfie_path: p })
    expect(start.error).toBeNull()
    expect(Math.abs(new Date(start.data.started_at).getTime() - Date.now())).toBeLessThan(60_000)

    const open = await c.cashier.rpc('my_open_shift')
    expect(open.data?.id).toBe(start.data.id)

    const again = await c.cashier.rpc('start_shift', { p_selfie_path: p })
    expect(again.error?.message).toMatch(/Shift already started/)
  })

  it('selfies and shifts are private: staff see their own, the admin sees the store\'s, a customer sees none', async () => {
    const { data: own } = await c.cashier.from('shifts').select('id, selfie_path')
    expect(own).toHaveLength(1)
    const { data: all } = await c.boss.from('shifts').select('id').eq('user_id', u.cashier.id)
    expect(all).toHaveLength(1)
    const { data: none } = await c.customer.from('shifts').select('id')
    expect(none ?? []).toHaveLength(0)

    const adminUrl = await c.boss.storage.from(BUCKET).createSignedUrl(own[0].selfie_path, 60)
    expect(adminUrl.error).toBeNull()
    const customerUrl = await c.customer.storage.from(BUCKET).createSignedUrl(own[0].selfie_path, 60)
    expect(customerUrl.error).not.toBeNull()
  })

  it('end_shift closes the open shift; a second end is refused', async () => {
    const end = await c.cashier.rpc('end_shift')
    expect(end.error).toBeNull()
    expect(end.data.ended_at).toBeTruthy()
    expect((await c.cashier.rpc('my_open_shift')).data).toBeNull()
    const again = await c.cashier.rpc('end_shift')
    expect(again.error?.message).toMatch(/No open shift/)
  })

  it('NEGATIVE: a vitest-b staff member is not staff in 224 and sees no vitest-b shifts there', async () => {
    const in224 = await signInClient(u.cashier.email, TEST_PASSWORD, { tenant: '224clubhouse' })
    // The JWT claim (vitest-b) wins over the header, so force 224 through a
    // user with no access: a 224 customer.
    const cust224 = await createTenantUser(admin, 'staff-224cust', '224clubhouse')
    u.cust224 = cust224
    const c224 = await signInClient(cust224.email, TEST_PASSWORD)
    expect((await c224.rpc('is_staff')).data).toBe(false)
    const { data } = await c224.from('shifts').select('id')
    expect(data ?? []).toHaveLength(0)
    // The cashier's own claim keeps them in vitest-b whatever header they send.
    expect((await in224.rpc('current_tenant')).data).toBe(TEST_TENANT)
  })

  it('a deactivated staff member is no longer staff and cannot start a shift', async () => {
    mustSucceed('deactivate', await c.boss.rpc('admin_set_staff_active', {
      p_user_id: u.cashier.id, p_active: false,
    }))
    expect((await c.cashier.rpc('is_staff')).data).toBe(false)
    const p = path(u.cashier, `${Date.now()}-b.jpg`)
    const { error } = await c.cashier.rpc('start_shift', { p_selfie_path: p })
    expect(error?.message).toMatch(/Not authorized/)
  })

  // ---- Review fixes: admins can close shifts; selfies are cleaned up ----

  async function openShiftFor(label) {
    mustSucceed('re-add', await c.boss.rpc('admin_add_staff', {
      p_email: u[label].email, p_full_name: `Vitest ${label}`,
    }))
    const p = path(u[label], `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`)
    expect((await upload(c[label], p)).error).toBeNull()
    const start = await c[label].rpc('start_shift', { p_selfie_path: p })
    expect(start.error).toBeNull()
    return { id: start.data.id, path: p }
  }

  it('the admin can end a staff member open shift; staff cannot end someone else one', async () => {
    const { id } = await openShiftFor('cashier')
    const byCustomer = await c.customer.rpc('admin_end_shift', { p_shift_id: id })
    expect(byCustomer.error?.message).toMatch(/Not authorized/)
    const byAdmin = await c.boss.rpc('admin_end_shift', { p_shift_id: id })
    expect(byAdmin.error).toBeNull()
    expect(byAdmin.data.ended_at).toBeTruthy()
    expect((await c.cashier.rpc('my_open_shift')).data).toBeNull()
  })

  it('disabling a staff member ends their open shift', async () => {
    await openShiftFor('cashier')
    mustSucceed('disable', await c.boss.rpc('admin_set_staff_active', {
      p_user_id: u.cashier.id, p_active: false,
    }))
    const { data } = await admin.from('shifts').select('ended_at')
      .eq('user_id', u.cashier.id).is('ended_at', null)
    expect(data).toHaveLength(0)
  })

  it('shift_selfies_to_purge lists unused uploads but not a selfie a shift still uses; only the service role may call it', async () => {
    const used = await openShiftFor('cashier')
    const orphan = path(u.cashier, `${Date.now()}-orphan.jpg`)
    expect((await upload(c.cashier, orphan)).error).toBeNull()

    const denied = await c.boss.rpc('shift_selfies_to_purge', { p_orphan_after: '0 seconds', p_keep: '90 days' })
    expect(denied.error).not.toBeNull()

    const { data, error } = await admin.rpc('shift_selfies_to_purge', { p_orphan_after: '0 seconds', p_keep: '90 days' })
    expect(error).toBeNull()
    const names = (data ?? []).map(r => r.name ?? r)
    expect(names).toContain(orphan)
    expect(names).not.toContain(used.path)
    await c.cashier.rpc('end_shift')
  })
})
