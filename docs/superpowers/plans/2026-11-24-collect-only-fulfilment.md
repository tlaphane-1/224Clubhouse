# Collect-only Fulfilment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a store run in `collect` mode (online order, collect at the club, no delivery, no drivers); switch Explosive 420 to it while 224 Clubhouse keeps delivery unchanged.

**Architecture:** One per-store switch in two places: `tenant.json` `delivery.mode` (browser + edge functions via generated stores) and `tenants.fulfilment` (Postgres, authoritative for the server). The server zeroes the fee and stores `{}` as the address in collect mode, and `is_driver()` returns false there, which blocks every driver RPC and policy at once. The UI keeps the existing status/payment values and relabels them per mode (approach A).

**Tech Stack:** React 19 + Vite, Tailwind v3, Supabase (Postgres RPCs, Deno edge functions), vitest 4 (unit + live contract tests), no component-test library (UI logic is tested through pure functions).

**Spec:** `docs/superpowers/specs/2026-11-24-collect-only-fulfilment-design.md`

## Global Constraints

- Branch first (`feat/e420-collect-only`); never commit to `master`. First commit: the spec + this plan.
- Mode values exactly `'delivery'` | `'collect'`. 224 → `delivery`, explosive420 → `collect`.
- Money is integer cents. In collect mode the fulfilment fee is `0`; the server recomputes it (never trust the client).
- Collect orders store `shipping_address = '{}'::jsonb` (column stays `jsonb not null`).
- 224 behaviour must not change: every existing test stays green unmodified.
- Collect-mode labels, verbatim: `out_for_delivery` → "Ready for Collection", `delivered` → "Collected", `cash_on_delivery` → "Cash on Collection", `card_on_delivery` → "Card on Collection". `eft` stays "EFT (Bank Transfer)".
- Payment note (collect, non-EFT), verbatim: "No payment now — you'll pay by cash/card when you collect."
- Membership perk replacement text (rollout, not code): "Free rolling paper when you stay at the lounge".
- No store literals in `src/` (`brandLiterals.unit.test.js`); address/hours/maps come from `tenant.contact` / `tenant.hours`.
- UI uses `docs/DESIGN_SYSTEM.md` tokens and existing classes (`bg-surface`, `border-border`, `text-gold`, `text-muted`, `.btn-outline`); phone-first (390/360 px, 44 px taps). Invoke `ui-reviewer` before done.
- After any `tenant.json` change: `node scripts/build-function-stores.mjs` and commit the generated file.
- Verify each task with `npm run lint` and `npm test`; the final task also runs `npm run build`, `npm run build:e420` and `npm run test:contract` against the local stack (`npm run test:local`).

## Review Focus

1. **Tampered client in a collect store** sends a street address and expects the R30 fee: the server must still store `{}` and fee `0`. → Task 2 test.
2. **Tampered client in a delivery store** (224) omits the address: unchanged 224 behaviour, fee still R30 under R500. → Task 2 test (224 regression).
3. **An E420 admin who is also a driver** opens `/driver` or calls `driver_start_delivery`: refused. → Task 2 test.
4. **Old E420 orders that already have a street address** shown in `/orders` or `/track`: no address block, no map, collection wording. → Task 5 (`showCollectFrom` test).
5. **Mode drift**: `tenant.json` says `collect` but no migration set the column (or the reverse): a unit test fails. → Task 1 test.

---

### Task 1: The switch (config, loader, browser flag, function stores, drift test)

**Files:**
- Modify: `tenants/224clubhouse/tenant.json` (`delivery.mode: "delivery"`), `tenants/explosive420/tenant.json` (`delivery.mode: "collect"`)
- Modify: `tenants/loadTenant.mjs` (`validateTenant`: enum check next to the cents check, ~line 119)
- Modify: `src/tenant.js`
- Modify: `scripts/build-function-stores.mjs` (`functionStore`), `supabase/functions/_shared/stores.ts` (`Store`), regenerate `supabase/functions/_shared/stores.generated.ts`
- Test: `src/__tests__/loadTenant.unit.test.js`, `src/__tests__/tenant.unit.test.js`, `src/__tests__/functionStores.unit.test.js`, create `src/__tests__/fulfilmentDrift.unit.test.js`

**Interfaces:**
- Produces: `IS_COLLECT: boolean` and `FULFILMENT: 'delivery'|'collect'` exported from `src/tenant.js`; `Store.fulfilment: 'delivery'|'collect'` in edge functions.

- [ ] **Step 1: Write failing tests**
  - `loadTenant.unit.test.js`: `validateTenant({...ref, delivery: {...ref.delivery, mode: 'pickup'}})` throws `/delivery.mode must be "delivery" or "collect"/`; both real tenants load.
  - `tenant.unit.test.js`: with the default (224) tenant, `IS_COLLECT === false` and `FULFILMENT === 'delivery'`.
  - `functionStores.unit.test.js`: `functionStore(loadTenant('explosive420')).fulfilment === 'collect'`, 224's is `'delivery'`.
  - `fulfilmentDrift.unit.test.js`: the set of slugs whose `tenant.json` has `delivery.mode === 'collect'` equals the set of slugs matched across `supabase/migrations/*.sql` by `/update public\.tenants set fulfilment = 'collect' where slug = '([a-z0-9-]+)'/g` minus slugs later matched by the same regex with `'delivery'` (process files in name order). Expected now: `['explosive420']`.
- [ ] **Step 2: Run** `npx vitest run src/__tests__/loadTenant.unit.test.js src/__tests__/tenant.unit.test.js src/__tests__/functionStores.unit.test.js src/__tests__/fulfilmentDrift.unit.test.js` — expect FAIL.
- [ ] **Step 3: Implement.** Add the key to both `tenant.json` files; enum check in `validateTenant`; `export const FULFILMENT = tenant.delivery.mode` and `export const IS_COLLECT = FULFILMENT === 'collect'` in `src/tenant.js`; `fulfilment: t.delivery.mode` in `functionStore` and the `Store` interface; run `node scripts/build-function-stores.mjs`. The drift test stays red until Task 2's migration exists; commit Task 1 with it red is not allowed, so write the drift test here but commit it with Task 2.
- [ ] **Step 4: Run** the same command — expect PASS (drift test passes after Task 2).
- [ ] **Step 5: Commit** `feat(tenant): add per-store fulfilment mode (delivery|collect)`

### Task 2: Server — column, helper, collect-mode order RPC, drivers off

**Files:**
- Create: `supabase/migrations/20261124120000_collect_fulfilment.sql`
- Create: `src/__tests__/collectFulfilment.contract.test.js`
- Modify: `package.json` (append the new test to `test:contract` and `predeploy` lists)

**Interfaces:**
- Produces: `tenants.fulfilment text not null default 'delivery' check (fulfilment in ('delivery','collect'))`; `public.tenant_fulfilment() returns text` (stable, security definer, `set search_path = public`, `coalesce((select fulfilment from tenants where slug = current_tenant()), 'delivery')`, granted to anon + authenticated like `tenant_min_age()`).

- [ ] **Step 1: Write the failing contract test** (pattern: `orderPin.contract.test.js`; gate with `probeMigration` on `tenants.fulfilment`; use `ensureTestTenant`, `createTenantUser`, `signInClient(..., { tenant: TEST_TENANT })`; `beforeAll` sets `vitest-b` to `collect` via service role, `afterAll` resets it to `delivery`). Cases:
  - `collect: order ignores the address and charges no fee` — order placed with a full street address and subtotal under R500 → row has `shipping_fee === 0`, `total === subtotal - discount`, `shipping_address` deep-equals `{}`.
  - `collect: set_order_pin is refused` — `error.message` matches `/Order not found|not available/`.
  - `collect: a driver is not a driver` — insert an active `drivers` row for the user in `vitest-b`; `rpc('is_driver')` → `false`; `rpc('driver_start_delivery', { p_order_id })` errors `/Not authorized/`.
  - `delivery (224 regression): same order shape still charges 3000 and keeps the address` — 224 client, subtotal under R500 → `shipping_fee === 3000`, `shipping_address.street === '1 Test St'`.
  - `tenant_fulfilment()` returns `'collect'` for `vitest-b`, `'delivery'` with no header.
- [ ] **Step 2: Run** `npx vitest run src/__tests__/collectFulfilment.contract.test.js` against the local stack — expect SKIP (migration not applied), then after `supabase db reset` on local with the empty migration file present, FAIL.
- [ ] **Step 3: Write the migration:**
  - add column + check; `update public.tenants set fulfilment = 'collect' where slug = 'explosive420';` (exact text the drift regex reads).
  - `tenant_fulfilment()` as above.
  - `create or replace function public.place_cod_order(...)`: copy the body verbatim from `20261102140000_tenant_rpcs_orders.sql:39-…`, add `v_collect boolean := public.tenant_fulfilment() = 'collect';`, change only the shipping line to `v_shipping := case when v_collect then 0 when v_is_member or v_subtotal >= 50000 then 0 else 3000 end;` and the inserted address to `case when v_collect then '{}'::jsonb else jsonb_build_object(...existing...) end`. Header comment lists exactly these two changes. Keep the existing grants.
  - `set_order_pin`: copy from `20261110120000_order_location_pin.sql`, add `if public.tenant_fulfilment() = 'collect' then raise exception 'Order not found'; end if;` after the sign-in check. Keep grants.
  - `is_driver()`: copy from `20261102130000_tenant_policies.sql:52`, add `and public.tenant_fulfilment() = 'delivery'` inside the `exists`. This blocks `driver_start_delivery`, `driver_complete_delivery`, `driver_update_location` and driver RLS without touching them.
- [ ] **Step 4: Run** `supabase db reset` (local) then the contract test, then the existing `cod`, `orderPin`, `driverPortal`, `deliveryEta`, `tenancy` contract suites — expect PASS, all unchanged.
- [ ] **Step 5: Commit** `feat(db): collect fulfilment mode — no fee, no address, no drivers`

### Task 3: Labels and fee helpers (pure functions)

**Files:**
- Modify: `src/utils/orderStatus.js`, `src/utils/shipping.js`
- Test: create `src/utils/orderStatus.test.js`; extend `src/utils/` shipping tests if present, else create `src/utils/shipping.test.js`

**Interfaces:**
- Consumes: `IS_COLLECT` (Task 1).
- Produces: `labelsFor(mode: 'delivery'|'collect') -> { status: Record<string,string>, payment: Record<string,string> }`; `STATUS_LABELS` / `PAYMENT_LABELS` become `labelsFor(FULFILMENT).status/.payment` so `statusLabel` / `paymentLabel` callers need no change. `shippingFeeFor(subtotalCents, isMember, mode = FULFILMENT) -> number`; new `SHOW_DELIVERY_FEE: boolean` (`!IS_COLLECT`).

- [ ] **Step 1: Failing tests:** `labelsFor('collect').status.out_for_delivery === 'Ready for Collection'`, `.delivered === 'Collected'`, `.payment.cash_on_delivery === 'Cash on Collection'`, `.payment.card_on_delivery === 'Card on Collection'`, `.payment.eft === 'EFT (Bank Transfer)'`; `labelsFor('delivery')` deep-equals today's maps (copy current values into the test). `shippingFeeFor(10000, false, 'collect') === 0`; `shippingFeeFor(10000, false, 'delivery') === 3000` (224 values).
- [ ] **Step 2: Run** `npx vitest run src/utils/orderStatus.test.js src/utils/shipping.test.js` — FAIL.
- [ ] **Step 3: Implement.** Add a one-line comment at `labelsFor` that in collect mode the stored value `delivered` means "collected" (approach A). Check every `PaymentMethodSelect` / status-pill renderer uses these helpers; replace any raw label string found (`grep -rn "Out for Delivery\|on Delivery\|on delivery" src`).
- [ ] **Step 4: Run** tests + `npm test` — PASS.
- [ ] **Step 5: Commit** `feat(ui): collect-mode status and payment labels`

### Task 4: Checkout and cart

**Files:**
- Create: `src/components/checkout/checkoutValidation.js` (move `validate` out of `Checkout.jsx`), `src/components/checkout/CollectFromCard.jsx`
- Modify: `src/pages/Checkout.jsx`, `src/components/checkout/CheckoutForm.jsx`, `src/components/checkout/OrderSummary.jsx`, `src/pages/Cart.jsx`, `src/utils/cartToast.js`
- Test: create `src/components/checkout/checkoutValidation.test.js`

**Interfaces:**
- Produces: `validateCheckout(form, { collect: boolean }) -> Record<string,string>`; `<CollectFromCard />` (no props; reads `tenant.contact.street/suburb/city`, `tenant.contact.mapsLink`, `tenant.hours.status`).

Layout (approved with this plan): in collect mode the form column reads

```
CONTACT & COLLECTION
[ Full name           ]
[ Email (locked)      ]
[ Phone               ]
┌ Collect from ───────────────────────┐   bg-surface border-border rounded
│ 📍 702 Aubrey Matlakala St,         │   text-white
│    Soshanguve Block L, Soshanguve   │
│ 🕘 Open Monday – Sunday, 09:00–22:00│   text-muted text-sm
│ [ Open in Maps ]                    │   .btn-outline, min-h-[44px]
└─────────────────────────────────────┘
PAYMENT  ( ) Cash on Collection ( ) Card on Collection ( ) EFT
```
No address fields, no "Use my location". Summary shows no delivery line.

- [ ] **Step 1: Failing tests:** with `collect: true`, a form with empty `street/city/province/postalCode` returns `{}` when name/email/phone are valid; with `collect: false` the same form returns errors for `street`, `city`, `province`, `postalCode` (today's messages verbatim).
- [ ] **Step 2: Run** `npx vitest run src/components/checkout/checkoutValidation.test.js` — FAIL.
- [ ] **Step 3: Implement.** `Checkout.jsx` calls `validateCheckout(form, { collect: IS_COLLECT })`; heading "Contact & Collection" when collect; only call `set_order_pin` when `!IS_COLLECT`; payment note uses the verbatim collect text; member-free-delivery promo hidden when collect. `CheckoutForm` renders address block and `UseMyLocation` only when `!IS_COLLECT`, and `<CollectFromCard />` when collect. `OrderSummary`, `Cart`, `cartToast`: hide delivery-fee/free-delivery lines when `!SHOW_DELIVERY_FEE`.
- [ ] **Step 4: Run** tests, `npm run lint`, `npm test`; `npm run demo:e420` and check checkout at 390 px — no address fields, card visible, total = subtotal.
- [ ] **Step 5: Commit** `feat(checkout): collect-only checkout for collect stores`

### Task 5: Customer order views

**Files:**
- Modify: `src/pages/OrderDetail.jsx`, `src/pages/TrackOrder.jsx`, `src/pages/OrderConfirmation.jsx`, `src/pages/Invoice.jsx`, `src/pages/Account.jsx`
- Create: `src/utils/fulfilmentView.js`; Test: `src/utils/fulfilmentView.test.js`

**Interfaces:**
- Consumes: `CollectFromCard` (Task 4), `IS_COLLECT`.
- Produces: `showCollectFrom(order, collect: boolean) -> boolean` (true when collect and status not in `['delivered','cancelled']`); `showDeliveryDetails(collect) -> boolean` (`!collect`).

- [ ] **Step 1: Failing tests:** `showCollectFrom({status:'preparing', shipping_address:{street:'1 Old St'}}, true) === true` (old order with an address still shows collection); `…({status:'delivered'}, true) === false`; `…({status:'preparing'}, false) === false`.
- [ ] **Step 2: Run** `npx vitest run src/utils/fulfilmentView.test.js` — FAIL.
- [ ] **Step 3: Implement.** In collect mode: no `DeliveryTracker`, no address block, no shipping line; render `CollectFromCard` when `showCollectFrom`. Labels already come from Task 3.
- [ ] **Step 4: Run** tests + lint + `npm test`.
- [ ] **Step 5: Commit** `feat(orders): collection view for customer order pages`

### Task 6: Admin and driver surfaces

**Files:**
- Modify: `src/App.jsx` (`/driver` and `/admin/drivers` routes only when `!IS_COLLECT`; `/driver` falls through to the existing 404/redirect), `src/components/admin/AdminLayout.jsx` (Drivers nav item), `src/pages/admin/Orders.jsx` (`DriverAssign`, `OrderLocation`), `src/pages/admin/Dashboard.jsx`, `src/pages/admin/Alerts.jsx`, `src/components/admin/OrderWhatsAppActions.jsx`, `src/utils/staffWhatsApp.js`
- Test: extend `src/utils/staffWhatsApp.test.js`

**Interfaces:**
- Consumes: `IS_COLLECT`, `labelsFor`.

- [ ] **Step 1: Failing test:** staff WhatsApp message builder called with `mode: 'collect'` contains "collect" and no "deliver" (case-insensitive); with `'delivery'` it equals today's output (existing tests unchanged).
- [ ] **Step 2: Run** `npx vitest run src/utils/staffWhatsApp.test.js` — FAIL.
- [ ] **Step 3: Implement.** Add a `mode = FULFILMENT` parameter to the builder(s); hide driver UI and routes as listed. Admin status buttons pick up Task 3 labels.
- [ ] **Step 4: Run** tests + lint + `npm test`; `npm run demo:e420`: no Drivers nav, `/driver` not reachable, order row shows "Ready for Collection".
- [ ] **Step 5: Commit** `feat(admin): hide driver features in collect stores`

### Task 7: Legal, content and WhatsApp order panel

**Files:**
- Modify: `src/pages/legal/DeliveryReturns.jsx` (collect variant: "Collection & Returns" — where/when to collect, bring ID, payment at collection or EFT before, uncollected orders may be cancelled by the club, returns section unchanged), `src/pages/legal/Terms.jsx`, `src/pages/legal/PrivacyPolicy.jsx` (collect: drop delivery address, location pin, driver position from data held), `src/pages/Home.jsx`, `src/pages/ProductDetail.jsx`, `src/pages/Membership.jsx`, `src/components/layout/Footer.jsx` (link text "Collection & Returns"), `src/components/store/WhatsAppOrderPanel.jsx` (default to its existing "Collection" mode and hide the delivery option when collect)
- Modify: `tenants/explosive420/tenant.json` (`seo.routes["/delivery-returns"]` title "Collection & Returns" + description; `legal.lastUpdated` to the deploy date), regenerate function stores
- Test: create `src/__tests__/collectWording.unit.test.js`

- [ ] **Step 1: Failing test:** for each customer-facing file listed in Tasks 4–7, read the source and assert every user-visible "deliver" string sits inside an `IS_COLLECT`/`SHOW_DELIVERY_FEE`/mode-gated branch — implement as: the file imports `IS_COLLECT`, `FULFILMENT`, `SHOW_DELIVERY_FEE` or `labelsFor` (a cheap guard that the file was considered). Plus `tenant.json` for explosive420 has no `/deliver/i` in `seo.routes['/delivery-returns'].title`.
- [ ] **Step 2: Run** `npx vitest run src/__tests__/collectWording.unit.test.js` — FAIL.
- [ ] **Step 3: Implement** the collect variants. 224 text stays byte-identical.
- [ ] **Step 4: Run** tests, lint, `npm test`, `npm run build:e420`; in `demo:e420`, search each page for "deliver" and "driver" (browser find) — none outside the returns policy's own wording about not delivering.
- [ ] **Step 5: Commit** `feat(content): collection wording for collect stores`

### Task 8: Emails

**Files:**
- Create: `supabase/functions/_shared/fulfilmentCopy.ts` (pure, no Deno imports)
- Modify: `supabase/functions/send-order-email/index.ts`, `supabase/functions/send-status-email/index.ts`
- Test: create `src/__tests__/fulfilmentCopy.unit.test.js`

**Interfaces:**
- Consumes: `Store.fulfilment` (Task 1).
- Produces: `statusCopyFor(mode, status) -> {subject, heading, message} | null`; `paymentLabelFor(mode, method) -> string`; `amountDueLabel(mode, method) -> string`.

- [ ] **Step 1: Failing tests:** `statusCopyFor('collect','out_for_delivery').subject` is "Your {store} order is ready for collection"; message mentions collecting and has no "driver"/"deliver"; `statusCopyFor('collect','delivered').heading` is "Order Collected ✅"; `statusCopyFor('delivery', s)` equals today's `STATUS_COPY[s]` for every status (move the map into this file unchanged); `paymentLabelFor('collect','cash_on_delivery') === 'Cash on collection'`; `amountDueLabel('collect','cash_on_delivery') === 'Amount due on collection'`.
- [ ] **Step 2: Run** `npx vitest run src/__tests__/fulfilmentCopy.unit.test.js` — FAIL.
- [ ] **Step 3: Implement.** Both functions resolve `storeFor(order.tenant).fulfilment`. Collect mode: customer receipt shows a "Collect from" block (`store.address`, `store.hours`) instead of the address; no shipping row; owner alert shows "Collection" in place of "Deliver to", omits the pin, and says "To collect at the counter"; `send-status-email` returns early for `kind === 'nearby'` when collect, and its status email for `out_for_delivery` includes address + hours. Telegram text untouched (E420 has Telegram off).
- [ ] **Step 4: Run** tests + `npm test`; `npx supabase functions serve` locally (or `npm run test:local`) and place an E420 order on the local stack: receipt + "ready" email render as above.
- [ ] **Step 5: Commit** `feat(email): collection copy for collect stores`

### Task 9: Verify, review, docs

**Files:**
- Modify: `OPEN_ITEMS.md` (§7d: E420 no longer uses drivers; new rollout checklist), `CLAUDE.md` (one paragraph under Multi-store: fulfilment mode, where it lives, approach A meaning of `delivered`)

- [ ] **Step 1:** `npm run lint && npm test && npm run build && npm run build:e420` — all exit 0.
- [ ] **Step 2:** `npm run test:local` (full contract suite on the local stack) — all pass, including the new suite.
- [ ] **Step 3:** Invoke the `ui-reviewer` subagent on the diff; fix every CRITICAL, justify skipped WARNINGs in the PR.
- [ ] **Step 4:** Update the docs above, including the rollout list from the spec (in-flight E420 orders check, deploy DB + both builds together after the account checks, edit E420 tier perks to "Free rolling paper when you stay at the lounge", Firebase preview channel test on a phone, one real order end to end).
- [ ] **Step 5: Commit** `docs: collect-only mode and E420 rollout`, push the branch (after the account checks in `CLAUDE.md`) and open a PR. Do not deploy; deployment is a separate, confirmed step.
