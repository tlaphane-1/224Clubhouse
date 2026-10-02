# 224 Clubhouse — Production Hardening Plan

Synthesized from five parallel investigation agents (2026-06-04). Plan-first; execute in the order below.

## Cross-cutting dependency (read first)

The `orders` table has one RLS policy — `orders_auth_all` (`auth.role() = 'authenticated'`) — but **checkout runs anonymously**. So anon order creation/confirmation is either broken in prod or RLS isn't enforced as written. **Both the payment-verification and admin-RLS workstreams rewrite the `orders` policy**, so they must be done together (one coordinated migration) to avoid conflicting and breaking the confirmation page.

---

## Workstream 1 — Commit outstanding work  ✅ priority: do first

Branch: `feature/memberships-and-pages` (never commit to `master`).

Correction to original plan: **un-ignore `scripts/image-manifest.json`** — it's imported by `useStorageImages.js`, so it must be committed or fresh clones won't build. Keep the staging dirs ignored.

Commit sequence (each snapshot builds; ordered by dependency) — DONE on branch `feature/memberships-and-pages`:
- [x] `chore: ignore image staging directories` — `.gitignore` (staging dirs only, NOT the manifest)
- [x] `chore: add data/image ops scripts and deps` — `scripts/*`, `scripts/image-manifest.json`, `package.json`, `package-lock.json` (cheerio, node-fetch)
- [x] `feat: add Supabase storage image helper` — `src/hooks/useStorageImages.js`
- [x] `feat: add membership system` — `Membership.jsx`, `admin/Memberships.jsx`, `useMemberships.js`, `supabase/migrations/20260329200000_memberships.sql`
- [x] `feat: add About/Contact pages, wire routes, refresh layout` — `About.jsx`, `Contact.jsx`, `App.jsx`, `Navbar.jsx`, `Footer.jsx`, `Home.jsx`, `AdminLayout.jsx`
- [x] `docs: add CLAUDE.md and task plan` — `CLAUDE.md`, `tasks/todo.md`
- Build verified green after commits. Branch not yet pushed (awaiting your go-ahead).

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

### Admin authorization  — code written (provider-agnostic), pending live apply
- [x] New migration `supabase/migrations/20260604120000_admin_authorization.sql`: `admin_users` table (FK → auth.users), `SECURITY DEFINER is_admin()` helper, seed current admin from `auth.users` by email.
- [x] Drop all `*_auth_*` write policies on products/events/memberships/newsletter (+ storage upload/delete); replace with `is_admin()`. Public SELECT on products/events and public INSERT on memberships/newsletter kept.
- [~] `orders` policy: **DEFERRED to the payment workstream** (left as original `auth.role()='authenticated'`). Tightening it now would break live anon checkout/confirmation with no server-side replacement.
- [x] `AuthContext.jsx`: derive `isAdmin` via `rpc('is_admin')`; resolve admin in `signIn` before returning (avoid redirect race). Removed `VITE_ADMIN_EMAILS` (and from `.env.example`; `CLAUDE.md` updated).
- [x] **APPLIED 2026-06-22.** Existing `auth.users` row `admin@224clubhouse.co.za` already matched the seed (no edit needed). Reset its password via `scripts/provision-admin.mjs`, ran `supabase db push --yes` (project `aogdkqczvlffgydgxsmz` confirmed linked), verified end-to-end with `scripts/verify-admin.mjs`: `admin_users` has 1 row, anon sign-in + `rpc('is_admin')` → `true`. Live admin login at https://224clubhouse.web.app/admin/login works.

Decision pending (you): **payment provider — Paystack vs Yoco** (+ confirm cannabis is permitted by the processor) before the payment half of Workstream 2 proceeds.

---

## Workstream 3 — Layered DB/RLS tests  ✅ built & verified green (Layers 1/2 skip until keys provided)

- [x] Add Vitest (`test: { environment: 'node' }`), `test`/`test:contract`/`audit:rls`/`predeploy` scripts. Adapted from `EFF/election-monitoring-app/frontend/`.
- [x] Layer 1 (`src/__tests__/api.contract.test.js`): 9 `.limit(0)` read probes from `src/hooks/`, service-role key, auto-skip when absent.
- [x] Layer 2 (`api.anonContract.test.js`): anon key; **PII negative-controls** — anon CANNOT read `orders`, `memberships` (SA ID numbers), `newsletter_subscribers`; positive controls for `products`/`events`.
- [x] Layer 3 (`scripts/audit-embed-rls.mjs` + wrapper): ported; asserts `problems === 0` (no `rows > 0` assertion — zero embeds today; future guard). Fixed: excludes `__tests__`/`*.test.*` so it reports `0 embeds inspected`.
- [x] Wire `.env.local` into tests via `test/loadEnv.mjs` reusing the `seed.js` parser.
- [ ] **YOU run for full Layer 1/2 coverage:** put `SUPABASE_SERVICE_ROLE_KEY` + `VITE_SUPABASE_ANON_KEY` in `.env.local`, then `npm run test:contract`. Without keys the suite is green with 2 skips.
- Note: Layer 2 negative-controls already assert the hardened PII posture; re-run after `supabase db push` to confirm the admin migration didn't loosen anything.

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

---

## Workstream 5 — Admin Products page improvements (in progress)

The `/admin/products` CRUD already exists (create/edit/delete/toggle/upload). Improving it.

Scope (approved):
1. Search + filters (name search, category, availability, stock)
2. Column sorting (name, price, stock)
3. Form validation (price/stock NaN guards, required name/category, duplicate-slug guard on create)
4. Image cleanup on delete (remove orphaned files from `product-images` bucket)
5. Galleries — admin (view all images per product) + store cards (cycle images)

Tasks:
- [ ] util `src/utils/storageImages.js`: `storagePathFromUrl(url)` + `deleteProductImages(urls)` (parse path after `/product-images/`, call `storage.remove`)
- [ ] Products.jsx: client-side search/category/availability/stock filters + sortable headers (useMemo over `useAllProducts`)
- [ ] Products.jsx: image-count badge on table thumb; click opens read-only gallery Modal
- [ ] Products.jsx handleDelete: delete storage files after the row delete succeeds
- [ ] ProductForm.jsx: validation + delete file from storage when an image is removed
- [ ] ProductCard.jsx: multi-image dot indicators, hover/tap to change image (no nav conflict)
- [ ] Verify: `npm run lint` + `npm run build`

Notes:
- `docs/DESIGN_SYSTEM.md` (referenced in CLAUDE.md) does NOT exist — using tokens from tailwind.config.js + index.css.
- Product images stored as full public URLs; storage path = everything after `/product-images/`.
- Uploads are immediate (on file-select) → removing an image should delete from storage immediately too.
- Storefront ProductDetail.jsx already has a full gallery — not touching it.

---

## Workstream 6 — Full gap-closure roadmap (started 2026-08-13, customers waiting)

From the 3-agent gap analysis (memberships facade, account UX, comms black hole, legal, ops).
Branch: `feature/memberships-and-pages`. Commit incrementally; deploy only after account gates.

### Wave 1 — P0 ✅ done 2026-08-13
- [x] Contact-messages admin inbox: `/admin/messages` + Layer 1 probe + Layer 2 anon negative control (16 live contract tests green)
- [x] Hygiene bundle: cart cleared on sign-out (CustomEvent bridge, reducer extracted to `cartReducer.js` + 3 unit tests); dead `CartDrawer.jsx`/`useOrderStatus.js` deleted (grep-verified); autoComplete on all 8 checkout fields; dashboard "Revenue (delivered)" + outstanding sub-line
- [x] Mosate app found (`GitHub/mosate-restaurant`); WhatsApp flow fully mapped

### Wave 2 — P0 continued
- [x] Password reset (2026-08-13): `resetPassword`/`updatePassword` in AuthContext, shared `ForgotPasswordForm` (CustomerAuth 'forgot' mode + admin Login link), `/reset-password` recovery page (implicit-flow session detection), shared `passwordValidation` util + 8 unit tests. E2E manual pass still pending (needs a real reset email). WhatsApp panel now hides entirely in prod when `VITE_WHATSAPP_NUMBER` unset (dev shows disabled state).
- [x] **WhatsApp order flow**: ported to `src/utils/whatsappOrder.js` + `WhatsAppOrderPanel` on Cart page; 6/6 unit tests; NEEDS `VITE_WHATSAPP_NUMBER` from owner (CTA disabled until set)
- [x] `RESEND_API_KEY` set on project (browser session, key never in transcript, sending-only permission, name `224clubhouse`)
- [x] INTERIM email domain (owner decision 2026-08-13): free Resend plan's 1-domain slot is taken by `effyouthcommand.org.za`; both edge functions now build `from` off `MAIL_FROM_DOMAIN` secret (set to effyouthcommand.org.za; unset to revert to 224clubhouse.co.za once verified — needs Resend Pro $20/mo or a second free account). Both functions redeployed `--use-api`; live test send returned success.
- [x] Supabase Auth URL config fixed via dashboard 2026-08-13: **Site URL was `http://localhost:3000`** (confirmation emails were sending customers to localhost!) → now `https://224clubhouse.web.app`; redirect allowlist was EMPTY → added `https://224clubhouse.web.app/**` + `http://localhost:5173/**` (verified after reload, Total URLs: 2)
- [x] WhatsApp number received 2026-08-13 (`27750868783`), added to `.env.local`, deployed from a clean worktree at HEAD (in-flight Wave 3 tree changes excluded), verified live: wa.me link carries cart + number correctly on /cart
- [ ] OWNER still: custom SMTP for the auth mailer (built-in sends 2–4/hr from supabase.io; can use Resend SMTP — smtp.resend.com, user `resend`, password = the API key — but entering the key is an owner action)

### Wave 3 — P1 make membership real (in flight 2026-08-13)
- [x] Migration WRITTEN, NOT PUSHED: `supabase/migrations/20260813150000_membership_accounts_tiers.sql` — membership_tiers (seeded, public-select active, admin ALL), memberships.user_id/tier_id/approved_at/status_history + owner-select RLS + partial unique pending-per-user index, place_membership auth-required + account-email override + null clock until approval, admin_update_membership_status (activation stamps clock, actor history), admin_create_membership (walk-in), membership_effective_status (query-time expiry, no cron). 9 contract tests skip-gated on migration presence (probe on membership_tiers). ⚠ DEPLOY COUPLING: push breaks the anonymous Membership.jsx flow — DB + frontend ship together, like the 2026-08-08 orders migration.
- [~] Customer frontend (agent running): useMembershipTiers/useMyMembership, Membership.jsx sign-in-required + DB tiers + own-membership status card
- [~] Admin frontend (agent running): RPC status updates, detail view (history/hidden fields), walk-in modal, tier CRUD, expiring-soon tile
- [ ] Enforce `is_member_only`: place_cod_order check (extend unpushed migration) + UI gating via useMyMembership (after customer agent lands)
- [ ] Membership confirmation email on approval (Resend now live — new edge function + call from admin status RPC flow)
- [ ] Coordinated ship: review package → supabase db push → frontend deploy → run un-skipped membership contract tests live

### Wave 4 — P2/P3 (built 2026-08-13, shipping with Wave 3)
- [x] Navbar auth-aware (account dropdown, admin link) + `/account` page (email/signout, membership card, links)
- [x] `/orders/:id` OrderDetail (owner RLS via useMyOrder maybeSingle, TrackOrder timeline reuse, line items, address, amount due) + Reorder (current-price/stock revalidation, skip/cap toasts) + checkout prefill from last order (derived-state merge, no setState-in-effect)
- [x] `send-status-email` edge function (per-status subjects, pending/legacy skipped) called fire-and-forget from useUpdateOrderStatus; admin Orders passes name/email/number
- [x] `/admin/newsletter` subscribers page + RFC-4180 CSV export + AdminLayout nav
- [x] Legal pages `/privacy` `/terms` `/delivery-returns` (POPIA/ECT Act, verified R80/R500/2–5day numbers, draft banners, 2 owner decisions flagged: delivery area, failed-delivery policy); checkout terms checkbox now links real pages
- [x] Wave 3 enforcement: place_cod_order member-only gate appended to unpushed migration (verbatim copy of 20260808120000 + one gated addition); ProductCard/ProductDetail "Join to unlock" states (no member flicker); send-membership-email function; +1 contract test (pending membership does NOT unlock)
- [ ] Deferred post-ship: admin new-order notification email, newsletter unsubscribe route, WELCOME10 decision, stock restore on cancel, server-side age check in place_cod_order, events ticketing, reporting/CSVs
- vite.config.js: fileParallelism:false — live-DB contract suites were timing out under parallel file execution (root-caused, not flaky-skipped)

### Wave 5 — built 2026-08-14, NOT YET SHIPPED (4 migrations pending)
- [x] **Newsletter unsubscribe** (`20260814100000`): `unsubscribe_token` + `unsubscribed_at`, token-only `unsubscribe_newsletter` RPC (no unsubscribe-by-email — that would let anyone opt out anyone), idempotent, anon-callable; `/unsubscribe` page; List-Unsubscribe header; opt-outs excluded from the admin CSV even when viewing the Unsubscribed filter.
- [x] **Re-subscribe fix** (same migration, added by main): unsubscribing then signing up again hit the unique-email 23505 and left people permanently off the list. New `subscribe_newsletter` upsert RPC clears `unsubscribed_at`; `Home.jsx` now calls it and sends only `{email}` (the function reads name + token from the row).
- [x] **Stock restore on cancel** (`20260814101000`): restock under the orders row lock, idempotent (double-cancel cannot inflate), products locked in id order (no deadlock vs place_cod_order), missing products skipped. **delivered → cancelled deliberately does NOT restock** (phantom stock ⇒ oversell at a customer's door); history note says so. `order_cancel_restocks()` probe so the test can skip until pushed.
- [x] **Event reservations** (`20260814102000`): reserve online / pay at the door (no payment provider — same call as memberships). `event_reservations` + `events.capacity`, `reserve_event_seats` (auth required, account-email override, future-only, capacity under lock, members-only gate identical to place_cod_order, dedupe + partial unique index), `admin_update_reservation_status`, `event_seats_remaining` computed column. `/events/:id` detail page, cards now clickable, admin door list with check-in + CSV. ⚠ hooks select the computed column ⇒ **DB + frontend must ship together**.
- [x] **Admin new-order alert**: `send-order-email` also sends a plain internal alert to `ADMIN_ALERT_EMAIL` (comma-separated, skipped silently if unset), isolated so a failed alert can never break the customer receipt. Fixed en-ZA/Johannesburg timestamp. **Incidental bug fixed:** `paymentLabel` matched `'cash'`/`'card'` but the DB stores `cash_on_delivery`/`card_on_delivery`, so every receipt printed a generic "On delivery".
- [x] **WELCOME10 / discount codes** (`20260814103000`): `discount_codes` table (admin-only RLS — a public-readable table would leak every live code to the anon key), shared `discount_eval` helper so preview and order-time cannot drift, `validate_discount_code` preview, `place_cod_order` re-created with `p_discount_code default null` (old 3-arg signature DROPPED first to avoid an ambiguous overload). Free shipping judged on the **pre-discount** subtotal, else a coupon can cost someone free delivery and make the order dearer. Checkout code field + summary rows; `/admin/discounts` CRUD (deactivate, never delete).
- Routes wired by main: `/events/:id`, `/unsubscribe`, `/admin/discounts`.
- Verified: lint 10 pre-existing / zero new, build green, `vitest run src` 63 passed / 37 skipped (the 37 un-skip on push).
- [ ] SHIP: code-review high → fix criticals → commit → `supabase db push` (4 migrations) → deploy send-order-email + send-welcome-email → frontend deploy → re-run suite live → set `ADMIN_ALERT_EMAIL` secret.
- [ ] Known follow-ups: no reservation confirmation email; receipts don't show the discount line yet (row carries the data); `EventForm` has no capacity field (set from the admin door list); WhatsApp orders still create no order row (invisible to stock/admin) — decide whether they should.

### ✅ SHIPPED 2026-08-13 ~17:45
Migration `20260813150000` applied to production (`aogdkqczvlffgydgxsmz`); all 4 edge functions
redeployed `--use-api`; frontend deployed to Firebase Hosting. **Contract suite re-run live:
59 passed / 4 skipped** (was 50/13 — all 10 membership tests un-skipped and passed against prod).
Smoke-verified live: /membership renders tiers from the DB, /account gates with sign-in + forgot
password, /privacy renders with draft banner, /cart WhatsApp panel with the real number.

Code-review (high) found 10 confirmed issues pre-ship; all fixed before commit. Two were
ship-blockers: edge functions were anon-callable with attacker-chosen recipient + unescaped HTML
(phishing from the verified sending domain), and broken CORS meant browser-invoked sends silently
never delivered — including the pre-existing send-order-email, so checkout receipts had been
failing in browsers all along (the 2026-08-13 "delivered" proof was a CLI call, not a page).

### Original ship sequence: code-review high over uncommitted diff → fix criticals → commit chunks → supabase db push (breaks old anon membership flow; frontend deploys immediately after) → deploy send-membership-email + send-status-email --use-api → firebase deploy → un-skipped membership contract tests live → smoke test

### Layered tests (target: 11+ new specs across layers, added with each wave)
Layer 1 service-role probes for every new read path; Layer 2 anon/user negative+positive controls
(contact_messages, memberships owner-select, place_membership auth requirement, tiers table);
Layer 3 embed audit stays green; e2e for WhatsApp link build + password-reset UI.

---

## Review

### 2026-06-22 session — handoff prep
- **Hosting:** deployed to Firebase Hosting site `224clubhouse` → https://224clubhouse.web.app (old default `clubhouse-61730.web.app` disabled). Configs: `firebase.json` (SPA rewrites + asset caching), `.firebaserc`.
- **Client manual:** `docs/USER_GUIDE.md` (+ `.pdf`, `.html`) — non-technical how-to.
- **Admin auth migration:** applied live + verified (see Workstream 2). Admin login: `admin@224clubhouse.co.za`.
- **Mobile fixes:** `AdminLayout` responsive (drawer on phones); `Orders` mobile card view (was blank on phones); `Memberships` now wrapped in `AdminLayout`; `ProductDetail` carousel tap targets.
- **Auth robustness:** `AuthContext` initial load + signIn now time-boxed + always clears `loading` (no more infinite spinner on flaky mobile networks).
- **Bundle:** route-level `React.lazy` + Suspense, vendor `manualChunks`. Entry 854 KB → 32 KB. Firebase (145 KB) + admin no longer on storefront. **framer-motion fully removed** (132 KB raw / ~43 KB gzip) — replaced with CSS animation utilities in `index.css`; dependency uninstalled. Storefront initial ≈ 155 KB gzip (was 248 KB single bundle). All pages headless-verified rendering.
- **Admin image upload BUG fixed (root cause):** upload path used the raw filename; unicode/accented names (e.g. `café.jpg`) → Supabase "Invalid key" → upload failed. Added `src/utils/safeFileName.js`, used in `ProductForm` + `EventForm`, and surfaced the real error. Verified messy/unicode/emoji filenames now upload.
- **Ops scripts left:** `scripts/provision-admin.mjs` (reset admin password), `scripts/verify-admin.mjs` (test login end-to-end).

### 2026-06-23 — Cash/Card on Delivery + live tracking + tests (subagent build)
- **Migration `20260622130000_cod_and_tracking.sql`** (applied + verified live): added `payment_method`, `order_number`, `tracking_token`, `status_history` to orders; delivery status set (pending→confirmed→preparing→out_for_delivery→delivered). Three SECURITY DEFINER RPCs — `place_cod_order` (anon, server-recomputes totals + decrements stock), `get_order_tracking` (anon, number+email, null on mismatch — no enumeration), `admin_update_order_status` (is_admin only, appends history). orders table RLS stays locked; anon never touches it directly.
- **Checkout** now Cash/Card on Delivery (`PaymentMethodSelect`, Paystack hidden but code kept). **TrackOrder** page (`/track`, polls every 15s) with status timeline. **OrderConfirmation** rewritten (router state, COD callout, track CTA). **Admin Orders** uses the delivery status set + admin RPC + payment/order-number display; `Badge` got new status colors. Shared vocab in `src/utils/orderStatus.js`.
- **Tests:** `src/__tests__/cod.contract.test.js` (anon place/track + wrong-email + admin-boundary negative controls; self-cleaning). Playwright e2e (`e2e/*.spec.js` + `playwright.config.js`): storefront/cart, tracking not-found, admin login. **5 passed / 1 skipped** against the live site. `eslint.config.js` got a node-globals override for test/scripts dirs. Run: `npm run test:contract` (DB), `npm run test:e2e` (needs `npx playwright install chromium` once; `ADMIN_EMAIL`/`ADMIN_PASSWORD` env to exercise the admin-login e2e).
- Note: `predeploy` now includes the COD contract test, which writes+cleans a test order on the live DB (idempotent).

### 2026-06-23 — Security/robustness/reliability hardening (audited + fixed)
Driven by 3 parallel audits (DB, frontend/auth, robustness). Migration `20260623120000_security_hardening.sql` (applied + verified):
- **orders** RLS locked to admin-only (was any-authenticated — PII). Anon uses RPCs only.
- **stock oversell race** fixed: `for update` row lock + guarded decrement + `products.stock_quantity >= 0` CHECK.
- **place_cod_order** input caps (cart ≤50, qty 1–100, customer-field + email validation).
- **memberships**: forgeable public insert removed; new `place_membership` RPC (server prices the tier, validates 21+, creates **pending** for admin confirmation). Membership.jsx updated + "Application Received" copy.
- **contact_messages** table (public-insert/admin-select); Contact.jsx now really stores messages + only shows success on success (was a fake toast dropping messages).
- **decrement_stock** hardened (pinned search_path, revoked from anon).
Frontend: top-level **ErrorBoundary** (+ stale-chunk auto-reload) and real **404 page** (was redirect-to-home); **checkout double-submit guard + RPC-null check**; **query error states** w/ Retry on Store/Events + all admin pages; **formatZAR** NaN guard; storage **BASE derived from env**; **signOut** clears user/session; **security headers** in firebase.json (verified live).
Verified: all 4 DB test layers green (19 passed), Playwright e2e 5/5 against live, headers + 404 live.
Confirmed already-correct (no change): is_admin/get_order_tracking/admin_update_order_status definers, admin_users write-lock, no XSS sinks, no service-role key client-side, COD totals server-authoritative.

### Still open before real-money launch (unchanged)
- Server-side payment verification (Workstream 2) — keep Paystack in TEST mode until done.
- Contact form + membership confirmation emails are cosmetic (Workstream 4).
- POPIA: privacy policy + harden age gate.
- ESLint flat config missing React `jsx-uses-vars` rule → 49 pre-existing false-positive "unused" errors (`npm run build` is clean; `npm run lint` is not).
