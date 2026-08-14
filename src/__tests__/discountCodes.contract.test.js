/**
 * Live-DB contract test for discount codes (Layer 1 + 2).
 *
 * Covers migration 20260814103000_discount_codes:
 *   - discount_codes is admin-only. There is NO public select policy, so
 *     neither anon nor a signed-in customer may enumerate live codes — the
 *     negative control that keeps the whole coupon list from leaking through
 *     the anon key that ships in the browser bundle.
 *   - validate_discount_code is authenticated-only and answers about exactly
 *     one code: {valid:true, ..., discount_cents} or {valid:false, reason}.
 *   - place_cod_order takes a CODE ONLY and recomputes the discount from its
 *     own DB-priced subtotal. The headline assertion: the stored total equals
 *     the server's own arithmetic, and there is no parameter through which a
 *     client can push an amount at all.
 *   - first_order_only (WELCOME10) stops being valid the moment the account
 *     has a non-cancelled order.
 *   - Free shipping is decided on the PRE-discount subtotal, so a code can
 *     never silently add the R80 fee back.
 *
 * Plus migration 20260814110000 (FIX 3):
 *   - get_order_tracking returns discount_code / discount_cents, so the four
 *     figures /track prints actually reconcile on a discounted order. That one
 *     case is gated on its own probe and skips if only 20260814103000 is live.
 *
 * REQUIRES migration 20260814103000 to be applied. Like the membership spec,
 * this is committed BEFORE its migration is pushed, so on top of the usual key
 * gate it probes discount_codes with the SERVICE-ROLE client at module load:
 * if the table isn't there yet the live suite auto-skips (and the skip banner
 * says why) instead of hard-failing.
 *
 * Because it MUTATES (creates a user, a code and an order, decrements stock),
 * afterAll cleans up with the service-role client and puts the stock back.
 * Idempotent — leftovers are purged first.
 *
 * Auto-skips unless BOTH VITE_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY
 * are set (service role is required for safe cleanup).
 *
 * How to run (PowerShell):
 *   npx vitest run src/__tests__/discountCodes.contract.test.js
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

// Migration probe. discount_codes is admin-only, so the ANON client would see
// an empty list whether or not the table exists — only the service role can
// tell "not migrated" (error) from "migrated" (rows). Top-level await is fine
// here: vitest test modules are ESM and the env setup file has already run.
//
// Second probe: 20260814110000 adds the discount fields to get_order_tracking
// inside an EXISTING function signature, so there is nothing readable to
// detect it by — it ships a one-line marker function for exactly this, the
// same idiom order_cancel_restocks() uses.
let MIGRATED = false
let FIXES_MIGRATED = false
if (!KEYS_MISSING) {
  const probe = createClient(URL, SERVICE, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error } = await probe.from('discount_codes').select('code').limit(1)
  MIGRATED = !error
  const { data: fixData, error: fixErr } = await probe.rpc('discount_newsletter_fixes_applied')
  FIXES_MIGRATED = !fixErr && fixData === true
}
const SKIP = KEYS_MISSING || !MIGRATED

// Clearly-marked test identities so cleanup can target exactly our rows.
const TEST_EMAIL = 'vitest+discount@example.com'
const TEST_PASSWORD = 'vitest-disc-5m4!Local'
const TEST_CODE = 'VITEST-DISCOUNT'
const TEST_PERCENT = 25
const TEST_QTY = 1

// Constants the RPC hardcodes (and OrderSummary.jsx mirrors).
const SHIPPING_THRESHOLD = 50000
const SHIPPING_FEE = 8000

const anon = SKIP
  ? null
  : createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } })
const admin = SKIP
  ? null
  : createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })
// Signed in as the test customer in beforeAll — the role real buyers hold.
const userClient = SKIP
  ? null
  : createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } })

// Shared state across the ordered tests.
let product = null
let testUserId = null
let consumedStock = 0
let discountedOrderNumber = null

async function purgeTestRows() {
  await admin.from('orders').delete().eq('customer_email', TEST_EMAIL)
  await admin.from('discount_codes').delete().eq('code', TEST_CODE)
}

async function purgeTestUser() {
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  const leftover = data?.users?.find((u) => u.email === TEST_EMAIL)
  if (leftover) await admin.auth.admin.deleteUser(leftover.id)
}

const orderPayload = (extra = {}) => ({
  p_customer: {
    name: 'Vitest Discount',
    email: 'spoofed+attacker@example.com', // ignored — the server stamps the account email
    phone: '0000000000',
    street: '1 Test St',
    apartment: '',
    city: 'Boksburg',
    province: 'Gauteng',
    postalCode: '1459',
  },
  p_items: [{ id: product.id, quantity: TEST_QTY }],
  p_payment_method: 'cash_on_delivery',
  ...extra,
})

describe.skipIf(SKIP)('Discount codes contract — server-computed discounts', () => {
  beforeAll(async () => {
    await purgeTestRows()
    await purgeTestUser()

    // A confirmed customer account with NO order history — first_order_only
    // codes must be valid for it until it places one.
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      email_confirm: true,
    })
    expect(createErr).toBeNull()
    testUserId = created.user.id

    const { error: signInErr } = await userClient.auth.signInWithPassword({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    })
    expect(signInErr).toBeNull()

    // A real, available, NON member-only product (the member-only gate would
    // reject this account and mask what we're testing). Two orders get placed
    // below — the discounted one and the 3-argument compatibility check — so
    // it needs stock for both.
    const { data, error } = await anon
      .from('products')
      .select('id, name, price, stock_quantity')
      .eq('is_available', true)
      .eq('is_member_only', false)
      .gte('stock_quantity', TEST_QTY * 2)
      .limit(1)
    expect(error).toBeNull()
    expect(Array.isArray(data) && data.length === 1).toBe(true)
    product = data[0]

    // A throwaway percentage code that is NOT first-order-only, so the test
    // account can actually place an order with it.
    const { error: codeErr } = await admin.from('discount_codes').insert({
      code: TEST_CODE,
      description: 'vitest fixture — safe to delete',
      kind: 'percent',
      value: TEST_PERCENT,
      first_order_only: false,
      is_active: true,
    })
    expect(codeErr).toBeNull()
  })

  afterAll(async () => {
    if (!admin) return
    await purgeTestRows()
    if (product && consumedStock > 0) {
      const { data: cur } = await admin
        .from('products')
        .select('stock_quantity')
        .eq('id', product.id)
        .single()
      if (cur) {
        await admin
          .from('products')
          .update({ stock_quantity: cur.stock_quantity + consumedStock })
          .eq('id', product.id)
      }
    }
    if (testUserId) await admin.auth.admin.deleteUser(testUserId)
  })

  it('POSITIVE: the WELCOME10 the welcome email promises actually exists', async () => {
    // Service role only — that it is invisible to everyone else is the next test.
    const { data, error } = await admin
      .from('discount_codes')
      .select('code, kind, value, first_order_only, is_active')
      .eq('code', 'WELCOME10')
      .single()
    expect(error).toBeNull()
    expect(data.kind).toBe('percent')
    expect(data.value).toBe(10)
    expect(data.first_order_only).toBe(true)
    expect(data.is_active).toBe(true)
  })

  it('NEGATIVE CONTROL: anon cannot read discount_codes (no code enumeration)', async () => {
    const { data, error } = await anon.from('discount_codes').select('code, value').limit(50)
    // Rows demonstrably exist (previous test read WELCOME10 with the service
    // role), so an empty result here is RLS doing its job, not an empty table.
    expect(error != null || (data?.length ?? 0) === 0).toBe(true)
  })

  it('NEGATIVE CONTROL: a signed-in non-admin cannot read discount_codes either', async () => {
    const { data, error } = await userClient.from('discount_codes').select('code, value').limit(50)
    expect(error != null || (data?.length ?? 0) === 0).toBe(true)
  })

  it('NEGATIVE: anon cannot call validate_discount_code', async () => {
    const { data, error } = await anon.rpc('validate_discount_code', {
      p_code: 'WELCOME10',
      p_subtotal_cents: 12345,
    })
    // Either the revoked grant blocks the call or the auth.uid() check returns
    // an invalid verdict — what must never happen is anon learning the value.
    expect(error != null || data?.valid !== true).toBe(true)
  })

  it('POSITIVE: a signed-in first-time customer validates WELCOME10 and gets 10% of a known subtotal', async () => {
    const subtotal = 12345 // R123.45
    const { data, error } = await userClient.rpc('validate_discount_code', {
      p_code: 'welcome10  ', // lowercase + whitespace: the server normalises
      p_subtotal_cents: subtotal,
    })
    expect(error).toBeNull()
    expect(data.valid).toBe(true)
    expect(data.code).toBe('WELCOME10')
    expect(data.kind).toBe('percent')
    expect(data.value).toBe(10)
    // Integer cents, truncated down — 10% of 12345 is 1234.5 -> 1234.
    expect(data.discount_cents).toBe(Math.floor((subtotal * 10) / 100))
  })

  it('NEGATIVE: an unknown code returns valid:false and reveals nothing about it', async () => {
    const { data, error } = await userClient.rpc('validate_discount_code', {
      p_code: 'NOT-A-REAL-CODE',
      p_subtotal_cents: 20000,
    })
    expect(error).toBeNull()
    expect(data.valid).toBe(false)
    expect(data.reason).toMatch(/not a valid code/i)
    expect(data.discount_cents).toBeUndefined()
  })

  it('NEGATIVE: there is no parameter through which a client can send a discount AMOUNT', async () => {
    // place_cod_order's signature is (jsonb, jsonb, text, text) — code only.
    // A forged amount has nowhere to go: PostgREST cannot resolve the call.
    const { data, error } = await userClient.rpc('place_cod_order', orderPayload({
      p_discount_code: TEST_CODE,
      p_discount_cents: 9999999,
    }))
    expect(error).not.toBeNull()
    expect(data).toBeNull()

    const { data: orders } = await admin
      .from('orders')
      .select('id')
      .eq('customer_email', TEST_EMAIL)
    expect(orders ?? []).toHaveLength(0)
  })

  it('NEGATIVE: an unusable code at order time is rejected with a recognisable prefix, and no order is created', async () => {
    const { data, error } = await userClient.rpc('place_cod_order', orderPayload({
      p_discount_code: 'NOT-A-REAL-CODE',
    }))
    expect(error).not.toBeNull()
    expect(data).toBeNull()
    // The frontend keys off this prefix to clear the code instead of showing
    // a raw database error.
    expect(error.message).toMatch(/Discount code:/i)

    const { data: orders } = await admin
      .from('orders')
      .select('id')
      .eq('customer_email', TEST_EMAIL)
    expect(orders ?? []).toHaveLength(0)
  })

  it('POSITIVE: place_cod_order computes the discount ITSELF and stores the server\'s own arithmetic', async () => {
    const { data, error } = await userClient.rpc('place_cod_order', orderPayload({
      p_discount_code: TEST_CODE.toLowerCase(), // normalised server-side
    }))
    expect(error).toBeNull()
    expect(data).toBeTruthy()
    consumedStock = TEST_QTY
    discountedOrderNumber = data.order_number

    // Everything below is derived from the PRODUCT PRICE IN THE DATABASE —
    // not from anything this client sent.
    const subtotal = product.price * TEST_QTY
    const expectedDiscount = Math.floor((subtotal * TEST_PERCENT) / 100)
    // Free shipping is decided on the PRE-discount subtotal, so a discount can
    // never push a qualifying cart back under the threshold.
    const expectedShipping = subtotal >= SHIPPING_THRESHOLD ? 0 : SHIPPING_FEE
    const expectedTotal = subtotal - expectedDiscount + expectedShipping

    expect(data.subtotal).toBe(subtotal)
    expect(data.discount_code).toBe(TEST_CODE)
    expect(data.discount_cents).toBe(expectedDiscount)
    expect(data.shipping_fee).toBe(expectedShipping)
    expect(data.total).toBe(expectedTotal)
    expect(data.total).toBeGreaterThanOrEqual(0)

    // ...and the persisted row says the same thing.
    const { data: row } = await admin
      .from('orders')
      .select('user_id, customer_email, subtotal, discount_code, discount_cents, shipping_fee, total')
      .eq('order_number', data.order_number)
      .single()
    expect(row.user_id).toBe(testUserId)
    expect(row.customer_email).toBe(TEST_EMAIL)
    expect(row.subtotal).toBe(subtotal)
    expect(row.discount_code).toBe(TEST_CODE)
    expect(row.discount_cents).toBe(expectedDiscount)
    expect(row.shipping_fee).toBe(expectedShipping)
    expect(row.total).toBe(expectedTotal)
    expect(row.subtotal - row.discount_cents + row.shipping_fee).toBe(row.total)

    // Redemption counted exactly once.
    const { data: code } = await admin
      .from('discount_codes')
      .select('times_redeemed')
      .eq('code', TEST_CODE)
      .single()
    expect(code.times_redeemed).toBe(1)
  })

  // Covers migration 20260814110000 (FIX 3). Skipped independently of the rest
  // of the suite so the file still runs green against a DB that has
  // 20260814103000 but not yet the follow-up.
  it.skipIf(!FIXES_MIGRATED)(
    'POSITIVE: get_order_tracking returns the discount, so /track totals reconcile',
    async () => {
      expect(discountedOrderNumber).toBeTruthy()

      // Anon on purpose: the tracking page is used logged out, and that grant
      // must survive the function being re-created.
      const { data, error } = await anon.rpc('get_order_tracking', {
        p_order_number: discountedOrderNumber,
        p_email: TEST_EMAIL,
      })
      expect(error).toBeNull()
      expect(data).toBeTruthy()

      const subtotal = product.price * TEST_QTY
      const expectedDiscount = Math.floor((subtotal * TEST_PERCENT) / 100)
      const expectedShipping = subtotal >= SHIPPING_THRESHOLD ? 0 : SHIPPING_FEE

      expect(data.discount_code).toBe(TEST_CODE)
      expect(data.discount_cents).toBe(expectedDiscount)
      // The headline assertion: the four figures the tracking page prints add
      // up. Before this migration discount_cents was absent and the customer
      // saw a Subtotal + Shipping that did not equal the Total beside it.
      expect(data.subtotal - data.discount_cents + data.shipping_fee).toBe(data.total)

      expect(data.subtotal).toBe(subtotal)
      expect(data.shipping_fee).toBe(expectedShipping)

      // Still no enumeration and still no extra PII: a wrong email returns
      // nothing at all, and the payload keeps its narrow field list.
      expect(data.customer_email).toBeUndefined()
      expect(data.customer_phone).toBeUndefined()
      const { data: wrong } = await anon.rpc('get_order_tracking', {
        p_order_number: discountedOrderNumber,
        p_email: 'someone+else@example.com',
      })
      expect(wrong).toBeNull()
    },
  )

  it('NEGATIVE: first_order_only — WELCOME10 stops validating once the account has an order', async () => {
    const { data, error } = await userClient.rpc('validate_discount_code', {
      p_code: 'WELCOME10',
      p_subtotal_cents: 12345,
    })
    expect(error).toBeNull()
    expect(data.valid).toBe(false)
    expect(data.reason).toMatch(/first order/i)
  })

  it('NEGATIVE: first_order_only is enforced at order time too, not just in the preview', async () => {
    const before = await admin
      .from('orders')
      .select('id')
      .eq('customer_email', TEST_EMAIL)

    const { data, error } = await userClient.rpc('place_cod_order', orderPayload({
      p_discount_code: 'WELCOME10',
    }))
    expect(error).not.toBeNull()
    expect(data).toBeNull()
    expect(error.message).toMatch(/first order/i)

    // No second order was created — the whole transaction rolled back.
    const { data: after } = await admin
      .from('orders')
      .select('id')
      .eq('customer_email', TEST_EMAIL)
    expect(after?.length ?? 0).toBe(before.data?.length ?? 0)
  })

  it('POSITIVE: the RPC still accepts a 3-argument call (no discount) — old callers keep working', async () => {
    const { data, error } = await userClient.rpc('place_cod_order', orderPayload())
    expect(error).toBeNull()
    expect(data.order_number).toMatch(/^224-/)
    consumedStock += TEST_QTY

    expect(data.discount_code).toBeNull()
    expect(data.discount_cents).toBe(0)
    const subtotal = product.price * TEST_QTY
    expect(data.total).toBe(subtotal + (subtotal >= SHIPPING_THRESHOLD ? 0 : SHIPPING_FEE))
  })
})

describe.skipIf(!SKIP)(
  KEYS_MISSING
    ? 'Discount codes contract skipped (need VITE_SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY)'
    : 'Discount codes contract skipped (migration 20260814103000_discount_codes not applied — run `supabase db push`)',
  () => {
    it('reminds devs how to enable the discount-codes contract test', () => {
      expect(true).toBe(true)
    })
  },
)

describe.skipIf(SKIP || FIXES_MIGRATED)(
  'get_order_tracking discount fields skipped (migration 20260814110000_discount_newsletter_fixes not applied — run `supabase db push`)',
  () => {
    it('reminds devs why the tracking-reconciliation case is skipped', () => {
      expect(true).toBe(true)
    })
  },
)
