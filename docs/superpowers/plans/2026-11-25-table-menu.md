# Table Menu, Membership Card, Table Orders, Ratings (part 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The same counter tablet, switched to table mode, is a customer menu: browse; identify by scanning their membership card QR (shown on their phone); see their last orders and "order again"; send an order to the counter (the cashier loads it into a sale); rate products they've had.

**Architecture:** Each customer account gets an unguessable card token (`member_cards`), shown as a QR (`<siteUrl>/m/<token>`) on the Account page. The tablet stays signed in as staff; every table action is a staff-only RPC that takes the scanned token and acts for that customer. Table orders are `table_requests` rows (no stock change) that the cashier loads into the normal `record_counter_sale` flow, then closes. Ratings go into the existing `product_reviews` (pending moderation) with the existing "has received this product" rule. Leaving table mode needs the staff account password.

**Spec:** `docs/superpowers/specs/2026-11-24-e420-in-store-design.md` (Part 3). Owner decisions 2026-11-24: membership QR instead of face recognition; build without further questions.

## Global Constraints

- Branch `feat/e420-in-store` (PR #45); `IN_STORE` gates all UI; store-scoped everything.
- Card token: `uuid` (gen_random_uuid), one per account per store; "New code" replaces it (old one stops working). QR text `${tenant.domain.siteUrl}/m/${token}`; parse accepts only https + `liveHosts` + `/m/<uuid>`.
- Identify by card only (no phone+PIN in this part — owner chose the membership QR). Customers without an account use the counter as walk-ins.
- Table requests expire: the counter lists only `pending` requests from the last 30 minutes; max 50 items per request; items validated (this store, available) but stock is only taken at the sale.
- Ratings: 1–5 stars, optional comment ≤ 1000, display name = the account holder's first name (from their latest order/membership name), status `pending` (admin moderates as today).
- Table screen resets to the menu after 3 minutes without a touch.
- POPIA: the table shows a customer only their own first name, membership status and orders — never phone or email.

## Review Focus

1. A forged or old (rotated) card token → "Card not recognised", nothing revealed. → Task 1 test.
2. A customer (not staff) calling table RPCs directly → refused. → Task 1 test.
3. A card from another store → not recognised. → Task 1 test.
4. Rating a product they never received → refused (existing rule). → Task 1 test.
5. A stale table order (> 30 min) → not shown to the counter. → Task 1 test.

---

### Task 1: Database (`20261125140000_table_menu.sql`, `src/__tests__/tableMenu.contract.test.js`)
- `member_cards(user_id uuid pk → auth.users cascade, tenant, token uuid unique not null default gen_random_uuid(), created_at)`; RLS: owner select own. RPCs (authenticated): `my_member_card() returns uuid` (creates if missing; the account must belong to this store), `rotate_member_card() returns uuid`.
- Staff RPCs (`is_staff()`):
  - `card_customer(p_token uuid) returns table(user_id, full_name, phone, member_status, tier_name, expires_at)` — for the counter's "Scan card" (also requires `counter_on_shift()`).
  - `table_identify(p_token uuid) returns jsonb {first_name, member_status, orders:[{order_number, created_at, items}] (last 10, non-cancelled), reviewable:[{product_id, name}] (products in their delivered orders, max 20)}` — no phone/email.
  - `table_submit_request(p_token uuid, p_items jsonb) returns uuid`.
  - `table_submit_review(p_token uuid, p_product_id uuid, p_rating int, p_body text) returns jsonb` — same checks as `submit_product_review`.
  - `counter_table_requests() returns table(id, created_at, user_id, full_name, phone, member_status, tier_name, expires_at, items jsonb)` — on shift; pending, last 30 min, oldest first; items enriched with current name/price/stock/option label.
  - `counter_close_table_request(p_id uuid, p_status text)` — `done|cancelled`, on shift.
- `table_requests(id, tenant, user_id, items jsonb, status pending|done|cancelled, created_at, closed_at, closed_by)`; RLS: admin select; no write policies.
- Tests: cases above + happy paths (card issue/rotate; identify returns own orders, no phone/email keys; request appears for the counter then closes; review saved pending; old token refused after rotate).

### Task 2: Pure helpers (`src/utils/table.js` + test)
`memberCardUrl(siteUrl, token)`, `parseMemberCode(text, hosts) -> token | null`, `requestToLines(items) -> cart lines` (skips unavailable/0-stock with a list of skipped names), `firstName(full) -> string`, `IDLE_MS = 180000`.

### Task 3: Membership card on the Account page + `/m/:token`
`src/components/account/MemberCard.jsx` (QR via `qrcode`, "Show this at the club", "New code" with confirm), shown on `/account` when `IN_STORE`; hooks `useMemberCard()`, `useRotateMemberCard()`; public route `/m/:token` → short page "This is a membership card for <store>. Show it at the club." (no lookup).

### Task 4: Table mode `/table` + counter integration
- `src/pages/counter/TableMode.jsx` (StaffRoute; full-screen; menu grid by category from `useProducts`; "Scan your membership card" → `QrScanner` with front camera; identified view: greeting, membership badge, last orders with "Order again", cart, "Send order to the counter", rating cards with stars; idle reset; "Staff" button → password prompt to exit).
- Table lock: entering `/table` sets `localStorage[storageKey('table-lock')]`; `StaffRoute` shows a password prompt instead of `/counter` while locked; correct password (re-sign-in as the current email) clears it.
- Counter Sale: "Scan card" in `CustomerPicker` (→ `card_customer`); "Table orders" list in `SalePanel` (poll 15 s) with "Load" (customer + cart via `requestToLines`) and "Dismiss"; after a loaded sale completes, close the request `done`.
- `QrScanner` gains `facing` prop (`'environment' | 'user'`).
- Counter header gets a "Table mode" button.

### Task 5: Verify, review, push
Lint, both builds, `npm run test:local`, fresh reviewer, fix Important+, `OPEN_ITEMS.md` §7f part 3, push.
