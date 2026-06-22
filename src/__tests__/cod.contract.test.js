/**
 * Live-DB contract test for the Cash/Card-on-Delivery flow (Layer 1 + 2).
 *
 * The COD flow is anonymous-by-design: customers never touch the `orders`
 * table directly (it stays RLS-locked). They go through three SECURITY
 * DEFINER RPCs:
 *   - place_cod_order      — anon creates an order; server recomputes totals
 *                            from DB prices and decrements stock.
 *   - get_order_tracking   — anon tracks by order_number + email (email is
 *                            the shared secret; wrong email -> null).
 *   - admin_update_order_status — admin-only; anon must be rejected.
 *
 * This spec exercises the real RPCs against the live DB with the ANON key
 * (the role real visitors use) and uses the service-role key only for
 * setup/teardown cleanup. Key controls:
 *   POSITIVE — anon can place an order and track it.
 *   NEGATIVE — tracking with the WRONG email returns null (no enumeration).
 *   NEGATIVE — anon CANNOT call admin_update_order_status (admin boundary).
 *
 * Because it MUTATES (creates an order, decrements stock), it cleans up in
 * afterAll with the service-role client: deletes the test order(s) and adds
 * the consumed stock back. It is idempotent — leftover test orders are
 * purged at start too.
 *
 * Auto-skips unless BOTH VITE_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY
 * are set (service role is required for safe cleanup, so we don't mutate the
 * DB without a way to undo it).
 *
 * How to run (PowerShell):
 *   npx vitest run src/__tests__/cod.contract.test.js
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const URL =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  'https://aogdkqczvlffgydgxsmz.supabase.co'
const ANON = process.env.VITE_SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
const SKIP = !ANON || !SERVICE

// Clearly-marked test identity so cleanup can target exactly our rows.
const TEST_EMAIL = 'vitest+cod@example.com'
const TEST_QTY = 1

const anon = SKIP
  ? null
  : createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } })
const admin = SKIP
  ? null
  : createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })

// Shared state across the ordered tests.
let product = null      // the product we ordered (for stock restore)
let orderNumber = null  // returned by place_cod_order
let placedTotal = 0

// Remove any leftover orders from a prior crashed run for our test email.
async function purgeTestOrders() {
  await admin.from('orders').delete().eq('customer_email', TEST_EMAIL)
}

describe.skipIf(SKIP)('COD contract — anonymous order + tracking RPCs', () => {
  beforeAll(async () => {
    await purgeTestOrders()
    // Fetch one real, available product via the ANON client (what a visitor sees).
    const { data, error } = await anon
      .from('products')
      .select('id, name, price, stock_quantity, is_available')
      .eq('is_available', true)
      .gte('stock_quantity', TEST_QTY)
      .limit(1)
    expect(error).toBeNull()
    expect(Array.isArray(data) && data.length === 1).toBe(true)
    product = data[0]
  })

  afterAll(async () => {
    if (!admin) return
    // Delete the order(s) we created.
    await purgeTestOrders()
    // Restore the stock we consumed so seeded data is unchanged.
    if (product) {
      const { data: cur } = await admin
        .from('products')
        .select('stock_quantity')
        .eq('id', product.id)
        .single()
      if (cur) {
        await admin
          .from('products')
          .update({ stock_quantity: cur.stock_quantity + TEST_QTY })
          .eq('id', product.id)
      }
    }
  })

  it('POSITIVE: anon place_cod_order creates an order with a 224- number and total > 0', async () => {
    const { data, error } = await anon.rpc('place_cod_order', {
      p_customer: {
        name: 'Vitest COD',
        email: TEST_EMAIL,
        phone: '0000000000',
        street: '1 Test St',
        apartment: '',
        city: 'Boksburg',
        province: 'Gauteng',
        postalCode: '1459',
      },
      p_items: [{ id: product.id, quantity: TEST_QTY }],
      p_payment_method: 'cash_on_delivery',
    })
    expect(error).toBeNull()
    expect(data).toBeTruthy()
    expect(data.order_number).toMatch(/^224-/)
    expect(data.total).toBeGreaterThan(0)
    expect(data.status).toBe('pending')

    orderNumber = data.order_number
    placedTotal = data.total
  })

  it('POSITIVE: get_order_tracking with correct email returns the pending order', async () => {
    expect(orderNumber).toBeTruthy()
    const { data, error } = await anon.rpc('get_order_tracking', {
      p_order_number: orderNumber,
      p_email: TEST_EMAIL,
    })
    expect(error).toBeNull()
    expect(data).not.toBeNull()
    expect(data.order_number).toBe(orderNumber)
    expect(data.status).toBe('pending')
    expect(data.total).toBe(placedTotal)
  })

  it('NEGATIVE: get_order_tracking with WRONG email returns null (no enumeration)', async () => {
    expect(orderNumber).toBeTruthy()
    const { data, error } = await anon.rpc('get_order_tracking', {
      p_order_number: orderNumber,
      p_email: 'wrong+attacker@example.com',
    })
    expect(error).toBeNull()
    // Email is the shared secret — a mismatch must yield no row.
    expect(data).toBeNull()
  })

  it('NEGATIVE: anon CANNOT call admin_update_order_status (admin boundary)', async () => {
    expect(orderNumber).toBeTruthy()
    // Resolve the order id with the service-role client (anon cannot read orders).
    const { data: row } = await admin
      .from('orders')
      .select('id')
      .eq('order_number', orderNumber)
      .single()
    expect(row?.id).toBeTruthy()

    const { data, error } = await anon.rpc('admin_update_order_status', {
      p_order_id: row.id,
      p_status: 'confirmed',
    })
    // The RPC is granted to `authenticated` only AND raises 'Not authorized'
    // via is_admin(). Either the grant blocks it or the function rejects it —
    // the only unacceptable outcome is a successful status change.
    expect(error).not.toBeNull()
    expect(data).toBeNull()

    // Confirm the status was NOT changed under the hood.
    const { data: after } = await admin
      .from('orders')
      .select('status')
      .eq('order_number', orderNumber)
      .single()
    expect(after?.status).toBe('pending')
  })
})

describe.skipIf(!SKIP)('COD contract skipped (need VITE_SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY)', () => {
  it('reminds devs how to enable the COD contract test', () => {
    expect(true).toBe(true)
  })
})
