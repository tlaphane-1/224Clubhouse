# 224 Clubhouse — Production Hardening Plan

Synthesized from five parallel investigation agents (2026-06-04). Plan-first; execute in the order below.

## Cross-cutting dependency (read first)

The `orders` table has one RLS policy — `orders_auth_all` (`auth.role() = 'authenticated'`) — but **checkout runs anonymously**. So anon order creation/confirmation is either broken in prod or RLS isn't enforced as written. **Both the payment-verification and admin-RLS workstreams rewrite the `orders` policy**, so they must be done together (one coordinated migration) to avoid conflicting and breaking the confirmation page.

---

## Workstream 1 — Commit outstanding work  ✅ priority: do first

Branch: `feature/memberships-and-pages` (never commit to `master`).

Correction to original plan: **un-ignore `scripts/image-manifest.json`** — it's imported by `useStorageImages.js`, so it must be committed or fresh clones won't build. Keep the staging dirs ignored.

Commit sequence (each snapshot builds; ordered by dependency):
- [ ] `chore: ignore image staging directories` — `.gitignore` (staging dirs only, NOT the manifest)
- [ ] `chore: add data/image ops scripts and deps` — `scripts/*`, `scripts/image-manifest.json`, `package.json`, `package-lock.json` (cheerio, node-fetch)
- [ ] `feat: add Supabase storage image helper` — `src/hooks/useStorageImages.js`
- [ ] `feat: add membership system` — `Membership.jsx`, `admin/Memberships.jsx`, `useMemberships.js`, `supabase/migrations/20260329200000_memberships.sql`
- [ ] `feat: add About/Contact pages, wire routes, refresh layout` — `About.jsx`, `Contact.jsx`, `App.jsx`, `Navbar.jsx`, `Footer.jsx`, `Home.jsx`, `AdminLayout.jsx`
- [ ] `docs: add CLAUDE.md and task plan` — `CLAUDE.md`, `tasks/todo.md`

Leave unstaged / not committed: `.claude/settings.local.json` (machine-local permissions), `supabase/.temp/` (CLI metadata). Confirmed safe: `.env.local` is gitignored.
Flag: **Google Maps API key hardcoded** in `Contact.jsx:213` — browser-visible; restrict by HTTP-referrer in Google Cloud console. Supabase storage URL in `useStorageImages.js:9` is public — acceptable.

---

## Workstream 2 — Server-side payment verification + admin RLS (coupled security core)

### Payment verification
- [ ] New edge function `supabase/functions/verify-and-create-order/index.ts`: verify Paystack reference with secret key; **recompute total from DB prices** (block amount tampering); create order with service role; `ON CONFLICT (paystack_reference)` idempotency; move `decrement_stock` server-side; add CORS headers on the POST response (existing functions omit them).
- [ ] Gut `Checkout.jsx` `handlePaystackSuccess` (lines 46–110) → single `supabase.functions.invoke('verify-and-create-order', ...)` sending only item `id`+`quantity`.
- [ ] Centralize `SHIPPING_FEE`/`SHIPPING_THRESHOLD` (currently only in `OrderSummary.jsx`) so client + server can't drift.
- [ ] `supabase secrets set PAYSTACK_SECRET_KEY=...` (never client-side).
- [ ] Phase 2: `paystack-webhook` function (HMAC-SHA512 signature check) as durability net for "paid but tab closed".

### Admin authorization
- [ ] New migration `supabase/migrations/<ts>_admin_authorization.sql`: `admin_users` table (FK → auth.users), `SECURITY DEFINER is_admin()` helper, seed current admin from `auth.users` by email.
- [ ] Drop all `*_auth_*` write policies on products/events/memberships/newsletter; replace with `is_admin()`. Keep public SELECT on products/events and public INSERT on memberships/newsletter.
- [ ] `orders` policy: coordinate with payment work — no public INSERT (service role creates orders); admin-only select/update/delete; confirmation read served from the verify response or a tokenized lookup, not direct anon table read.
- [ ] `AuthContext.jsx`: derive `isAdmin` via `rpc('is_admin')`; keep `loading` true until it resolves (avoid flash-redirect). Remove `VITE_ADMIN_EMAILS` (and from `.env.example`, update `CLAUDE.md`).
- [ ] **Lock-out guard:** confirm the admin `auth.users` row exists before `supabase db push`. Keep a service-role insert ready as fallback.

---

## Workstream 3 — Layered DB/RLS tests (do after RLS hardening so it asserts new policies)

- [ ] Add Vitest (`test: { environment: 'node' }`), `test` + `predeploy` scripts. Reference templates: `EFF/election-monitoring-app/frontend/`.
- [ ] Layer 1 (`src/__tests__/api.contract.test.js`): 9 read probes from `src/hooks/`, service-role key, auto-skip when absent.
- [ ] Layer 2 (`api.anonContract.test.js`): anon key; **PII negative-controls** — assert anon CANNOT read `orders`, `memberships` (SA ID numbers), `newsletter_subscribers`; positive controls for `products`/`events`.
- [ ] Layer 3 (`scripts/audit-embed-rls.mjs` + wrapper): port from reference; **relax the `rows > 0` assertion** (no embeds exist today — it's a future guard).
- [ ] Wire `.env.local` into tests via a setup file reusing the `seed.js` parser.

---

## Workstream 4 — Phase-1 launch-blocker gap fixes

Surfaced by gap analysis (beyond the three scoped items):
- [ ] **Contact form silently drops messages** — calls non-existent `send-contact-email`; `.catch` shows fake "Message sent!". Deploy the function or store to a `contact_messages` table.
- [ ] **Membership confirmation email never sent** though UI claims it was.
- [ ] **`is_member_only` unenforced** — anyone can buy members-only products; "member pricing" not implemented. PRODUCT DECISION needed: enforce, or remove the badge/claims until a member system exists.
- [ ] `WELCOME10` promo promised in welcome email but honored nowhere — implement coupon or drop the promise.
- [ ] Add a React error boundary (one render error white-screens the app); real 404 page (currently redirects to `/`); surface hook `error` states (failed loads look like empty results).
- [ ] Code-split admin + Firebase out of the storefront bundle (852 kB → much smaller); lazy routes.
- [ ] **POPIA**: publish Privacy Policy + Terms + Returns/Delivery; wire the dead `Checkout.jsx:164` terms link; harden age-consent beyond a localStorage boolean (you store SA ID numbers).
- [ ] Atomic stock check at payment (RPC that fails on insufficient stock) to stop oversell.

### Phase 2 / 3 (later)
Status-change emails + fulfilment fields; refund flow + `refunded` status; admin CSV exports + subscriber/contact views; SEO (per-page meta, OpenGraph, robots/sitemap, Product JSON-LD); a11y pass (replace `<div onClick>` checkboxes with native inputs); image optimization; tokenized order lookup; delivery zones/pickup; optional customer/member accounts; search/sort/pagination.

---

## Review
(Fill in as workstreams complete.)
