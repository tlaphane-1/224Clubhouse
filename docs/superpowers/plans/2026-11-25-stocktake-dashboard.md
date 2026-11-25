# Stock-take + Live Dashboard (part 2b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff on shift count stock at the counter (scan or pick a product, type the counted number, give a reason) with every change logged; staff and admins see today's sales update live.

**Architecture:** New `stock_adjustments` log written only by the staff-on-shift RPC `counter_set_stock` (row lock, old → new, reason, who). A staff-only aggregate RPC `store_today_summary()` returns today's (SAST) totals with no personal data; the counter "Today" tab and the admin Dashboard poll it every 30 s.

**Tech Stack:** as parts 1–2a.

**Spec:** `docs/superpowers/specs/2026-11-24-e420-in-store-design.md` (Part 1: "Stock-take", "Live dashboard").

## Global Constraints

- Branch `feat/e420-in-store` (PR #45). Store-scoped everything; `IN_STORE` gates all UI.
- `counter_set_stock(p_product_id uuid, p_variant_id uuid, p_counted int, p_reason text, p_note text) returns jsonb {old_qty, new_qty}`: staff on shift (`counter_on_shift()`), `p_counted` 0–100000 (`'Enter a count from 0 to 100000'`), reason ∈ `count|received|damaged|other` (`'Invalid reason'`), note ≤ 200 chars; a product with options needs `p_variant_id` (`'Choose an option for "<name>"'`); unknown/other-store ids → `'Product not found'`.
- `stock_adjustments(id, tenant, product_id → products on delete cascade, variant_id → product_variants on delete set null, product_name text, variant_label text, old_qty int, new_qty int, reason text, note text, user_id → auth.users on delete set null, created_at)`; RLS select: admin (store) or own rows; no write policies.
- `store_today_summary() returns jsonb {day, sales, total, online, counter, top:[{name, quantity}], low_stock:[{name, left}]}` — `is_staff()` required; SAST calendar day; non-cancelled orders; top 5 by quantity; low stock ≤ 5 (products without options and options), max 10. No names, phones or emails of customers.
- "Live" = refetch every 30 s while the screen is open (staff cannot read `orders` rows, so Realtime on the table would show them nothing).

## Review Focus

1. Customer or off-shift staff calls `counter_set_stock` → refused. → Task 1 test.
2. Counting a product that has options without choosing one → refused. → Task 1 test.
3. Negative or huge count → refused, stock unchanged. → Task 1 test.
4. Today's summary leaks another store's sales or cancelled orders → excluded. → Task 1 test.
5. A customer calls `store_today_summary` → refused. → Task 1 test.

---

### Task 1: Database
Create `supabase/migrations/20261125130000_stocktake_today.sql`, `src/__tests__/stocktakeToday.contract.test.js` (cases above + "count writes the log row with old/new/reason/user and sets the stock" + "a variant count changes the variant"); add to `test:contract`/`predeploy`. Commit `feat(db): stock-take log and today's summary for staff`.

### Task 2: Pure helpers (`src/utils/stocktake.js` + test)
`STOCK_REASONS = [{value:'count',label:'Stock count'},{value:'received',label:'Delivery received'},{value:'damaged',label:'Damaged / lost'},{value:'other',label:'Other'}]`; `reasonLabel(v)`; `stockDelta(old, next) -> '+3' | '−2' | '0'`; `parseCount(text) -> int | null` (digits only, 0–100000). Commit `feat(stock): stock-take helpers`.

### Task 3: Counter "Stock" and "Today" tabs
`src/components/counter/StockPanel.jsx` (scan via `QrScanner` + `lineFromScan`, or pick via a product list showing current stock; then count input `inputMode="numeric"`, reason select, optional note, Save; shows "Saved: 12 → 9 (−3)"), `src/components/counter/TodayPanel.jsx` (cards: total today, sales count, online vs in store, top 5, low stock; loading/error/empty; "Updated hh:mm"), `src/hooks/useStock.js` (`useSetStock`, `useStockLog(limit)`), `src/hooks/useToday.js` (`useTodaySummary()` with `refetchInterval: 30_000`). Tabs in `Counter.jsx`: Sale | Stock | Today | Shift (Stock needs a shift like Sale). Commit `feat(counter): stock-take and live today view`.

### Task 4: Admin → Stock log + live Dashboard card
`src/pages/admin/Stock.jsx` (last 100 adjustments: when, product/option, old → new, delta, reason, who (staff name via second query), note); nav "Stock" (icon `ClipboardList`) + route behind `IN_STORE`; `src/pages/admin/Dashboard.jsx` gets a "Today (live)" card from `useTodaySummary()` when `IN_STORE`. Commit `feat(admin): stock log and live today card`.

### Task 5: Verify, review, push
Lint, both builds, `npm run test:local`, fresh reviewer, fix Important+, `OPEN_ITEMS.md` §7f, push.
