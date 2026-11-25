# Counter Sales (part 2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the E420 counter tablet, staff ring up an in-store sale: pick the customer (search or walk-in) and see their last 10 orders, add products by scanning printed QR labels or tapping, take cash/card, complete — stock drops and the sale lands in orders/reports.

**Architecture:** Counter sales are rows in `orders` with new `channel = 'counter'` and `served_by`, stored as already collected (`status = 'delivered'`, `paid_at` set). All writes and customer look-ups go through staff-only SECURITY DEFINER RPCs that re-price from the DB and lock stock rows like `place_cod_order`. QR labels encode the product's public URL (`<siteUrl>/store/<slug>?v=<variantId>`), so a customer's phone camera opens the product page and the counter parses the same code.

**Tech Stack:** React 19, TanStack Query, Supabase RPC, new deps `qrcode` (draw labels) and `@zxing/browser` (camera scanning; owner approved 2026-11-24).

**Spec:** `docs/superpowers/specs/2026-11-24-e420-in-store-design.md` (Part 1 "Cashier tablet": product codes, ringing up a sale; customer "memory").

## Global Constraints

- Branch `feat/e420-in-store` (continues PR #45). Never commit to `master`.
- Money integer cents; server recomputes every price; stock decremented with row locks; variant lines decrement the variant.
- Staff-only: every new RPC requires `is_staff()`; `record_counter_sale` also requires the caller's open shift (`'Start your shift first'`).
- Age: the cashier must tick "ID checked — 21 or older" (`p_id_checked = true`, else `'Confirm you checked their ID'`). Member-only products need the customer's active membership in this store (`'"<name>" is for members only'`).
- Counter payment methods reuse `cash_on_delivery` / `card_on_delivery` (labelled "Cash/Card on Collection" in E420). No discount codes at the counter.
- A counter sale: `channel='counter'`, `status='delivered'`, `shipping_fee=0`, `shipping_address='{}'`, `paid_at=now()`, `paid_amount_cents=total`, `payment_confirmed_by=served_by=auth.uid()`, `customer_email` = the account's email or `''` for walk-ins, `user_id` = the account if chosen.
- History = the customer's last 10 non-cancelled orders in this store (online and counter), newest first.
- UI: tablet/phone first, 44 px taps, `docs/DESIGN_SYSTEM.md` tokens; loading/empty/error states on every list.

## Review Focus

1. **Two counter sales race for the last unit** → one succeeds, the other gets `Insufficient stock`. → Task 1 test (sequential; row lock covers concurrency).
2. **A product id from another store** in the cart → `Product not found`. → Task 1 test.
3. **Walk-in with no account** → sale saves with `user_id null`, `customer_email ''`; history by phone works. → Task 1 test.
4. **Scanning a QR from another site or a random code** → "Not one of our labels", nothing added. → Task 2 test.
5. **Quantity above stock in the counter cart** → clamped to stock; server still refuses if stock moved. → Task 2 test + Task 1.

---

### Task 1: Database — counter sales, customer search, history

**Files:** Create `supabase/migrations/20261125120000_counter_sales.sql`, `src/__tests__/counterSales.contract.test.js`; modify `package.json` (add the suite to `test:contract` / `predeploy`).

**Interfaces — Produces:**
- `orders.channel text not null default 'online' check (channel in ('online','counter'))`; `orders.served_by uuid references auth.users(id) on delete set null`.
- `counter_find_customers(p_query text) returns table(user_id uuid, full_name text, phone text, email text, member_status text, tier_name text, expires_at timestamptz)` — staff only; `length(trim(p_query)) >= 2` else empty; matches (ILIKE) name/phone/email across this store's `memberships` and `orders` (latest name/phone per account or per phone for walk-ins); `member_status` ∈ `active|pending|expired|none`; max 10 rows.
- `counter_customer_history(p_user_id uuid, p_phone text) returns table(order_number text, created_at timestamptz, items jsonb, total int, channel text)` — staff only; by `user_id` when given, else by exact `customer_phone`; this store; `status <> 'cancelled'`; newest first; limit 10.
- `record_counter_sale(p_customer jsonb, p_items jsonb, p_payment_method text, p_id_checked boolean) returns jsonb {id, order_number, total}` — `p_customer`: `{user_id?, name, phone}`; `user_id` ignored unless it is an account of this store; items like `place_cod_order` (`{id, variant_id?, quantity}`).
- Grants: the three RPCs to `authenticated` only.

- [ ] **Step 1: Contract test** (pattern `staffShifts.contract.test.js`, store `vitest-b`; boss admin, cashier staff with an open shift, a customer account with an active membership, products incl. one member-only and one with a variant):
  - `customer cannot record a sale / search / read history` → `/Not authorized/`
  - `staff without an open shift → /Start your shift first/`
  - `id not checked → /Confirm you checked their ID/`
  - `sale for an account: stock drops, row has channel counter, status delivered, paid_at, served_by, user_id, total from DB prices`
  - `variant line decrements the variant`
  - `walk-in: user_id null, customer_email '', history by phone finds it`
  - `member-only product: refused for a walk-in, allowed for the member`
  - `insufficient stock → /Insufficient stock/; nothing changed`
  - `another store's product → /Product not found/`
  - `counter_find_customers finds the member by part of name and phone, reports member_status active; short query → no rows`
  - `history: newest first, max 10, excludes cancelled and other stores`
- [ ] **Step 2: Run** `npm run test:local -- src/__tests__/counterSales.contract.test.js` — SKIP (gate), then FAIL with the migration file empty.
- [ ] **Step 3: Write the migration**; apply locally (psql), record version, reload schema.
- [ ] **Step 4: Run** the suite + `cod`, `tenancy`, `staffShifts`, `tenantAudit`, `rlsEmbedAudit` — PASS.
- [ ] **Step 5: Commit** `feat(db): counter sales, customer search and order history for staff`

### Task 2: Pure counter logic + dependencies

**Files:** Create `src/utils/counter.js`, `src/utils/counter.test.js`; `npm install qrcode @zxing/browser`.

**Interfaces — Produces:**
- `labelUrl(siteUrl, product, variant?) -> string` → `${siteUrl}/store/${slug}` (+ `?v=${variant.id}`).
- `parseLabelCode(text, siteUrl) -> { slug, variantId } | null` — accepts only URLs whose origin equals `new URL(siteUrl).origin` (any of `tenant.domain.liveHosts` too) and path `/store/<slug>`; otherwise null.
- `counterCartReducer(state, action)` — state `{ lines: [{ key, productId, variantId, name, label, price, stock, quantity }] }`; actions `add` (line; increments if same key, clamps to stock), `setQty` (clamps 0..stock; 0 removes), `clear`.
- `cartTotal(lines) -> cents`; `toSaleItems(lines) -> [{ id, variant_id?, quantity }]`.
- `memberBadge(status) -> { label, tone }` (`active`→"Member", `pending`→"Membership pending", `expired`→"Membership expired", `none`→"Not a member").

- [ ] **Step 1: Failing tests** for each function (incl. Review Focus 4: other host, `/products/x`, plain text → null; Review Focus 5: add beyond stock clamps).
- [ ] **Step 2: Run** `npx vitest run src/utils/counter.test.js` — FAIL.
- [ ] **Step 3: Implement**; install deps (record versions in `package.json`).
- [ ] **Step 4: Run** tests + lint — PASS.
- [ ] **Step 5: Commit** `feat(counter): sale cart logic and label codes`

### Task 3: QR labels page

**Files:** Create `src/pages/admin/Labels.jsx`; modify `src/App.jsx` (`/admin/labels`, `ProtectedRoute`, `IN_STORE` only), `src/pages/admin/Products.jsx` (button "Print QR labels" linking there, `IN_STORE` only).

Page: every available product (and each option) as a label: QR (from `qrcode` `toDataURL(labelUrl(...), { margin: 1, width: 240 })`), name, option, price (`formatZAR`). Screen: grid with "Print" button; print CSS: A4, 3 × 8 labels (63.5 × 33.9 mm), black on white, nav hidden. Loading/empty/error states.

- [ ] **Step 1: Failing test:** `labelSheetItems(products) -> [{ key, name, option, price, url }]` in `src/utils/counter.js` (one per variant when a product has variants, else one per product; unavailable skipped).
- [ ] **Step 2–4:** run (FAIL) → implement page + helper → tests, lint, `npm run build:e420` PASS.
- [ ] **Step 5: Commit** `feat(admin): printable QR labels for products`

### Task 4: Counter sale screen

**Files:** Create `src/components/counter/SalePanel.jsx`, `CustomerPicker.jsx`, `CustomerHistory.jsx`, `ProductPicker.jsx`, `QrScanner.jsx`; `src/hooks/useCounter.js`; modify `src/pages/counter/Counter.jsx` (tabs "Sale" | "Shift"; Sale is default when on shift; off shift shows "Start your shift first" with a button to the Shift tab).

**Interfaces:** `useFindCustomers(query)` (debounced 300 ms, enabled at ≥2 chars), `useCustomerHistory({ userId, phone })`, `useRecordSale()` (invalidates `['products']`, `['orders']`); `QrScanner({ onCode, onClose })` uses `BrowserQRCodeReader.decodeFromVideoDevice` (rear camera preferred), stops the stream on close/unmount, shows "Camera blocked — allow camera access" on permission error.

Layout (tablet, `max-w-3xl`, two columns ≥ md, stacked on phones):
```
[ Sale ] [ Shift ]                                   On shift since 09:02
┌ Customer ──────────────────┐ ┌ Items ─────────────────────────────┐
│ [search name / phone…]     │ │ [📷 Scan label]  [search product…] │
│ results → tap              │ │ Strawberry Cough 3.5g  − 1 +  R150 │
│ or [Walk-in] name + phone  │ │ …                                  │
│ ── Member · Gold · to 03/27│ │ Total                        R300  │
│ Last orders                │ │ ○ Cash  ○ Card                     │
│ 24/11 · 2 items · R300     │ │ ☐ ID checked — 21 or older         │
│ …(up to 10)                │ │ [ Complete sale — R300 ]  btn-gold │
└────────────────────────────┘ └────────────────────────────────────┘
```
After success: toast "Sale E420-XXXX saved", cart and customer reset. Errors from the RPC shown inline (`text-red-400`) and as a toast; the cart is kept.

- [ ] **Step 1: Failing test:** `saleBlockers({ customer, lines, method, idChecked, onShift }) -> string[]` in `src/utils/counter.js` (e.g. `['Choose a customer or walk-in', 'Add at least one item', 'Choose cash or card', 'Tick that you checked their ID']`; empty when ready).
- [ ] **Step 2–4:** run (FAIL) → implement → tests, lint, build; local demo walkthrough: search the demo customer, see history, add by tapping, complete sale (cash), stock dropped, sale visible in Admin → Orders.
- [ ] **Step 5: Commit** `feat(counter): ring up sales with customer history and QR scanning`

### Task 5: Reports split, verify, review, docs

**Files:** Modify `src/pages/admin/Orders.jsx` (badge "Counter" on `channel='counter'` rows; filter chip "Counter"), `src/utils/salesReport.js` + test (`channelSplit(orders) -> { online, counter }` in cents of non-cancelled orders), `src/pages/admin/Reports.jsx` (one line "Online R… · Counter R…" when `IN_STORE`), `OPEN_ITEMS.md` (§7f part 2a).

- [ ] **Step 1–4:** failing `channelSplit` test → implement → `npm run lint && npm run build && npm run build:e420` → `npm run test:local` all pass.
- [ ] **Step 5:** fresh whole-branch reviewer; fix Critical/Important with tests; commit `feat(reports): online vs counter split`; push.
