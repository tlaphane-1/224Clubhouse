# 224 Clubhouse — Open Items

> Consolidated status as of **2026-10-07** (site launched publicly that day). Every claim here was
> verified against the repo or the live services on that date, not carried over from older notes.
>
> `tasks/todo.md` remains the older detailed engineering backlog; `tasks/store-upgrades.md` covers
> the 2026-10-05 upgrades. This file is the shorter "what is actually open and why it matters"
> list. Where they disagree, trust this file. Resolved items are kept, dated, in §8.
>
> **Updated 2026-11-09:** Explosive 420 went live on its own domain (§7c); the multi-store
> "must fix before a second store has an admin" items are closed. Later that day: a login now
> works only on its own store's site (PR #33), past events show on both stores (PR #33), and
> `/membership` no longer crashes for signed-in non-members (PR #34).
>
> **Updated 2026-11-23:** PRs #37–#40, all live since 2026-11-12: drivers get a sign-in email,
> customers can share their location at checkout, and Admin → Drivers always shows the map (§7d).
>
> **Updated 2026-11-24:** Explosive 420 asked to stop delivering ("too risky"). Branch
> `feat/e420-collect-only` makes it a **collect-only** store (order online, collect at the club):
> no address, no fee, no drivers. **Not deployed** — see §7e for the rollout checklist.

---

## 1. Blocked on the owner

### 1.1 Online payments (Paystack / Ozow) — waiting on a provider
The app takes cash/card **on delivery** or **EFT** (verified by an admin, §6). Online checkout is
disabled; `PaystackButton.jsx` is retained for re-enable. The owner must first get a payment
provider to accept a cannabis business. `docs/PAYSTACK_PLAN.md` and `tasks/todo.md` Workstream 2
have the server-side verification spec. **Never** re-enable client-trusted totals — the server must
recompute totals from DB prices.

### 1.2 Owner to-dos (no code)
- Delete or hide the `sss` product (looks like test data; it is in the sitemap).
- Supply a 1200×630 dark-background share image; WhatsApp/Facebook previews currently use the small
  white logo.
- Rename the auto-created admin driver profile (it is called "admin"): Admin → Drivers → Add driver
  with the admin's own email and real name (leaves the password alone).
- Do one real delivery end to end on a phone before relying on live tracking (still not done as
  of 2026-11-23: the only E420 delivery, E420-1ECF17, was marked Delivered before its driver
  first signed in, so no location was ever shared). Use it to check the location pin too (§7d).
- Restrict the Google Maps key (now `VITE_GOOGLE_MAPS_KEY` in `.env.local`) in Google Cloud to
  `224clubhouse.store/*`, `www.224clubhouse.store/*` and `224clubhouse.web.app/*`.
- Multi-store (Explosive 420): the club's inputs still open are listed in §7c.

---

## 2. Decisions waiting

None (PR #15 closed 2026-11-09, see §8).

---

## 3. Live defects / engineering debt

### 3.1 Live contract suites occasionally time out when run together
Each live contract suite passes on its own; a full combined run occasionally hits the ~90 s
network freeze (seen again 2026-10-05 on one newsletter test, passed on re-run).

### 3.2 Driver tracking stops when the portal is not on screen
`/driver` is a web page: the phone only shares location while it is open and visible (it keeps
the screen awake via the Wake Lock API where supported). Background tracking needs a native app.

### 3.3 Checkout never showed the confirmation page (fixed and live 2026-11-03)
Phone order `224-849A99` was stored, but the phone stayed on a blank checkout with an empty cart.
Cause (pre-existing, not stage 2): the router applies navigations as transitions, so clearing the
cart let Checkout's empty-cart redirect replace `/order-confirmation/...` with `/cart` ~10 ms later.
Fix: `placed` state in `Checkout.jsx` skips that redirect. Regression check (local stack only):
`node scripts/checkout-confirmation-local.mjs`, which fails without the fix and passes with it.
Deployed in PR #26; owner phone order confirmed the "Order Confirmed!" page.

---

## 4. Compliance and risk

### 4.1 Personal data held
SA ID numbers (memberships), dates of birth (memberships + `customer_profiles`, used for the
21+ check), delivery addresses and their geocoded points, proof-of-payment files (private
bucket `payment-proofs`), the customer's optional checkout location pin (`orders.pin_*`, nulled
with `dest_lat/dest_lng` 30 days after a delivered or cancelled order, cron `purge-order-pins`
02:50 daily), the latest driver position (deleted after each delivery round, swept
daily), saved carts (30-day purge) and anonymous site-usage events (13-month purge). Keep POPIA in
mind for any change touching these; the privacy policy (`src/pages/legal/PrivacyPolicy.jsx`)
describes each and must be kept in step.

---

## 5. Stale claims to correct in existing docs

- **`tasks/todo.md:66`** says the contact form calls a non-existent `send-contact-email` and fakes
  success. It no longer does — `Contact.jsx` inserts into a `contact_messages` table.

---

## 6. Notes for whoever picks this up

- **Account gates before any deploy** (see `CLAUDE.md`): `gh auth status` must be `tlaphane-1`,
  `firebase login:list` must be `tlaphane@gmail.com`, and the Supabase project ref is
  `aogdkqczvlffgydgxsmz`. Production deploys from `master` (all work goes through PRs).
- **Deploy order:** dry-run new migrations inside `begin; … rollback;` with
  `supabase db query --linked -f`, then `supabase db push`, run the live contract suites, deploy
  functions, then `firebase deploy --only hosting --non-interactive` (without
  `--non-interactive` it has hung for 10+ minutes on this machine).
- **Edge Function deploys need `--use-api`** (Docker Desktop doesn't start here). Functions called
  by pg_cron are deployed with `--no-verify-jwt` and authenticate with the `x-cron-secret` header:
  `send-cart-reminders` and `send-daily-summary` (07:00 SAST).
- **Cron secret:** Vault secret `cart_reminders_cron_secret` must equal the function secret
  `CRON_SECRET`; it is shared by every cron-called function. Rotate both together. Job runs are in
  `cron.job_run_details`, HTTP results in `net._http_response`. Function URLs are hardcoded in the
  migrations — change them there if the project ref ever changes.
- **Email config lives in function secrets:** `MAIL_FROM_DOMAIN` (= `224clubhouse.store`),
  `ADMIN_ALERT_EMAIL` (= `224clubhous@gmail.com` — **no "e" before the @**; owner confirmed
  2026-10-07, reversing a 2026-10-05 note), `EFT_BANK_DETAILS`. The same address is shown on the
  contact page, invoices, the unsubscribe page and the printable membership form. Supabase Auth mail
  goes through custom SMTP (Resend) from `noreply@224clubhouse.store` using `supabase/templates/`,
  generated by `scripts/build-auth-email-templates.mjs`. Ask the owner to check Spam/Promotions and
  add a Gmail filter for `from:orders@224clubhouse.store` if alerts seem missing.
- **EFT payments:** reference is the customer's **name and surname** (owner decision 2026-10-07).
  Unpaid EFT orders can't move to Preparing / Out for delivery / Delivered (enforced in
  `admin_update_order_status` and `driver_start_delivery`). Admin confirms at Admin → Orders →
  "EFT to check" after checking FNB; a customer's uploaded proof is a claim, not evidence.
- **Visitor analytics:** first-party, cookie-free (`site_events`, `track_event`, admin-only
  `site_analytics`). Only counts on `224clubhouse.store` / `.web.app`, not dev or preview channels;
  admins and `/admin` are excluded. Links shared with `?utm_source=whatsapp` are attributed.
- **Driver portal:** `/driver`. Admins create driver logins at Admin → Drivers (Edge Function
  `admin-create-driver`); every admin is also a driver (trigger on `admin_users`). Orders are
  assigned on Admin → Orders. Map tiles: OpenStreetMap via Leaflet (no key). Drivers sign in at
  `<store domain>/driver`, not the shop login. A driver appears on the map only after **Start delivery**
  on an order that is Out for Delivery, and only while the page stays open (§3.2).
- **Ops calls with the service-role key:** the `SUPABASE_SERVICE_ROLE_KEY` injected into Edge
  Functions is **not** the same string as the one in `.env.local` (both are valid). Never compare
  a caller's key to the env var; ask Auth instead (`callerIsServiceRole` in
  `_shared/supabaseClients.ts`, PR #38).
- **Store upgrades (2026-10-05):** product options (price/stock derived by trigger while options
  exist), cart reminders (hourly, `purge-saved-carts` daily), reviews (moderated), SEO prerender on
  every build (`scripts/prerender-seo.mjs`), invoices at `/orders/:id/invoice`.
- **Membership form PDF** (on letterhead): `docs/membership-form/`, built by
  `scripts/build-membership-form.mjs`.

---

## 7. Recently completed (2026-10-05 → 07) — do not redo

PR numbers are on `tlaphane-1/224Clubhouse`.

- **#9 Store upgrades:** product options, sales reports, abandoned-cart reminders, SEO prerender +
  sitemap, invoices, product reviews.
- **#10–#11, #14 EFT details:** bank details on invoices, at checkout and on every unpaid EFT order
  view; reference changed to the customer's name and surname.
- **#12 EFT verification:** proof-of-payment upload, admin "Payment received", dispatch gate.
- **#13 Visitor analytics** (Admin → Visitors) and **email-only order lookup retired**
  (`get_orders_by_email` dropped; `/track` needs order number + email).
- **#16 Club email** switched to `224clubhous@gmail.com`.
- **#17–#18 Driver portal** with live tracking; admins can drive.
- **Ops polish (2026-10-07/08):** 21+ age check enforced server-side (`customer_profiles`,
  `place_cod_order` refuses accounts without a 21+ DOB; asked once at signup or checkout); owner
  alerts (low stock in the new-order email, review-waiting email, 07:00 daily summary); driver
  portal installable as an app, destination geocoding (Nominatim) with distance/ETA for the
  customer, one-off "driver nearby" email within 1 km; **fixed** `Permissions-Policy` that blocked
  geolocation site-wide.

---

## 7a. Multi-store stage 1 live (2026-11-02)
PR #23 merged and deployed: every 224-specific fact now lives in `tenants/224clubhouse/`
(spec `docs/superpowers/specs/2026-10-24-multi-tenant-design.md`). Live site compared to the
pre-change build: 20/20 routes identical, Contact map present. No DB change. Next: stage 2
(tenant columns + RLS), which needs `SUPABASE_SERVICE_ROLE_KEY` reachable so the 39 live
contract tests actually run. Rollback: `firebase hosting:rollback --site 224clubhouse`.

## 7b. Multi-store stage 2 live (2026-11-03)
PR #25: the 7 `20261102*` migrations applied to production (owner ran `db push`). Every table
carries `tenant`; RLS and RPCs are store-scoped; 224 behaves as before. Checks against live:
`predeploy` 274 passed; tenancy suite 75 passed / 10 expected skips; compare-rendered 20/20.
Owner phone order `224-849A99` stored with `tenant = 224clubhouse`. Pre-push schema dump:
`C:\Users\azgcl\Documents\224-backups\pre-phase2-schema-20261103.sql`. Rollback:
`docs/superpowers/plans/2026-11-02-phase-2-rollback.md`.

### Multi-store: must fix before a second store has an admin — all fixed 2026-11-09 (PR #30)
- Image upload/delete is limited to each store's folder (`tenants.upload_folder`; 224 keeps the
  bucket root). Migration `20261109120000_store_image_folders`.
- Child rows must share their parent's store (check triggers). Migration
  `20261109130000_same_store_references`; 0 live rows disagreed at push.
- `telegram-connect` and `geocode-order` act only for the caller's own store.
- `admin-create-driver` creates the login in the admin's store and refuses another store's
  account. `scripts/provision-admin.mjs` passes no `app_metadata`, so the stamp is kept.

## 7c. Explosive 420 live on its own domain (2026-11-09)
- **Site:** https://explosive420.co.za (PR #31; Firebase custom domain, `www` redirects;
  `explosive420.web.app` still serves). Domain bought at domains.co.za (owner's account, 1 year,
  protection off).
- **Email (PR #30):** every customer email, owner alert, cart reminder and daily summary is branded
  and sent as the record's store. E420 sends from `orders@`/`hello@explosive420.co.za`, verified in
  the owner's single Resend account (same `RESEND_API_KEY`). E420 alerts go to
  `alert_settings.alert_emails` (owner's Gmail until the club gives an address).
- **Auth emails:** Send Email Hook `auth-send-email` enabled 2026-11-09 (secret
  `SEND_EMAIL_HOOK_SECRET`). Reset emails for both stores verified in the inbox. Rollback:
  Dashboard → Authentication → Auth Hooks → disable (the SMTP templates are still in place). The
  hook secret was pasted in chat once, so the owner should rotate it.
- **Checks:** `predeploy` 576 passed against live. All 13 functions boot; `verify_jwt` is false only
  for `auth-send-email`, `send-cart-reminders` and `send-daily-summary` (pinned in `config.toml`).
- **One login, one store (PR #33):** a 224 account signed in on explosive420.co.za read 224's
  orders and membership there, because `current_tenant()` trusts the account's
  `app_metadata.tenant` stamp over the site (RLS itself was correct). The site now refuses a session
  stamped for another store (`src/utils/accountStore.js`, `AuthContext.jsx`); sign-in shows "This
  email is registered with another club". An unstamped account is still accepted. Customers who use
  both clubs need a different email per club (a Gmail `+tag` address works).
- **Past events (PR #33):** `/events` lists the last six past events under the upcoming ones, greyed
  out and marked "Ended" (`usePastEvents`, `EventCard past`). On both stores.
- **`/membership` crash (PR #34):** every signed-in customer without a membership got "Something went
  wrong": the application sheet's footer read `tier.price_cents` before a tier was selected. Guarded
  (`footer={showForm && tier && (`), pinned by `membershipPage.unit.test.js`. Reproduced and
  verified on the local E420 stack; not yet re-checked by the owner on the live site.
- **Not yet verified:** see §7d (most E420 emails now verified; a 224 order and the live E420
  membership application are still open).
- **Owner to-do:** rotate the auth hook secret (it was pasted in chat): Auth Hooks → generate a new
  secret → Update, then set `SEND_EMAIL_HOOK_SECRET` to match.
- **Club inputs still open:** alert email, Capitec details (EFT stays off), dabs/extract prices,
  names for the two Outdoor grades, own photos, contact email,
  socials, POPIA information officer, membership price. The handover pack is in
  `C:\Users\azgcl\Documents\Explosive420-handover\` (outside the repo).
- **Runbook:** `docs/onboarding/explosive420-go-live.md`.

## 7d. Drivers and delivery location (PRs #37–#40, live 2026-11-12)
- **Driver sign-in email (PR #37):** Admin → Drivers → Add driver no longer needs a password; the
  driver is emailed "You've been added as a driver" with a 1-hour link to choose one
  (`_shared/driverWelcome.ts`, `generateLink({type:'recovery'})` → `/reset-password`, which sends
  drivers on to `/driver`). Each active driver has a **Send sign-in email** button
  (`send-driver-welcome`). `/driver` has **Forgot password?**; the navbar shows **My Deliveries**
  to drivers. On 2026-11-12 the email went to all 3 active E420 drivers (owner's request).
- **Ops path fix (PR #38):** `send-driver-welcome` with `{userId, tenant}` accepts any key Auth
  accepts as service role (see §6). The first bulk send had failed with 403 because of the key
  mismatch; nothing was sent until this was fixed.
- **Location pin at checkout (PR #39):** optional **Use my current location** fills the address
  (Nominatim reverse lookup; OSM ward names such as "Tshwane Ward 34" are never used as City) and,
  after `place_cod_order`, saves the point with `set_order_pin` (own order, `pending`, once, within
  15 minutes; migration `20261110120000_order_location_pin`). Admin → Orders shows "Customer's
  location" with a Maps link and the distance to the typed address (green ≤1 km, yellow ≤5 km, red
  beyond: "Call the customer before sending a driver"). The owner alert email/Telegram carry the
  link; the driver's Navigate and `geocode-order` prefer the pin. Privacy policy updated. Checked
  live: `orderPin.contract.test.js` 3/3. **Not seen on screen yet:** the admin location panel.
- **Always-on driver map (PR #40):** Admin → Drivers "On the road now" shows the map centred on
  `contact.mapCentre` even with nobody out, with a line explaining how a driver appears.
- **Verified from the owner's inbox (2026-11-12):** for E420, the order confirmation, owner alert,
  out-for-delivery and delivered emails, sign-up confirmation, cart reminder and the 07:00 daily
  summary (10 and 11 Nov). Still unverified: a 224 order since the 2026-11-09 email changes (last
  one 2026-11-03) and the membership application on live E420.

## 7e. Explosive 420 collect-only (branch `feat/e420-collect-only`, NOT deployed)

Owner feedback 2026-11-24: stop deliveries because of risk. Spec
`docs/superpowers/specs/2026-11-24-collect-only-fulfilment-design.md`, plan
`docs/superpowers/plans/2026-11-24-collect-only-fulfilment.md`.

- Per-store switch: `delivery.mode` in `tenant.json` and `tenants.fulfilment` (migration
  `20261124120000_collect_fulfilment.sql`); `fulfilmentDrift.unit.test.js` fails if they disagree.
- Collect stores: `place_cod_order` charges no fee and stores `shipping_address = {}`;
  `set_order_pin` refuses; `is_driver()` is false, so all driver RPCs and policies are off.
- Statuses are relabelled, not changed: `out_for_delivery` shows as "Ready for Collection",
  `delivered` as "Collected". E420 driver accounts are left in place but cannot act.

**Rollout checklist (owner present):**
1. List E420 orders still `confirmed` / `preparing` / `out_for_delivery`; the club finishes or
   contacts those customers before the switch.
2. Account checks (CLAUDE.md), then deploy in this order, back to back: **the migration first**,
   then the edge functions (`send-order-email`, `send-status-email`, `send-cart-reminders`), then
   both store builds. Never the E420 site before the migration: the new checkout shows no fee
   while the old `place_cod_order` would still charge R30 under R500. Migration first is harmless
   (the old site shows R30, the server charges 0).
3. Same session: Admin → Memberships, edit each E420 tier's perks — replace free delivery with
   "Free rolling paper when you stay at the lounge".
4. Bump E420 `legal.lastUpdated` if deploying after 24 November 2026; owner to read the new
   Collection & Returns, Terms §6 and Privacy wording.
5. Firebase preview channel for E420: check checkout on a phone (390 px — not yet checked), then
   one real order end to end (placed → ready-for-collection email → collected).
6. Then update the E420 handover pack (drivers no longer used).

## 7f. E420 in-store system, part 1: staff + selfie shifts (branch `feat/e420-in-store`, NOT deployed)

Owner feedback 2026-11-24. Spec `docs/superpowers/specs/2026-11-24-e420-in-store-design.md`, plan
`docs/superpowers/plans/2026-11-25-staff-shifts.md`. Built on top of `feat/e420-collect-only`
(merge #44 first).

- Staff accounts (`staff_members`, `is_staff()`), managed in Admin → Staff (by email of an existing
  account in the store). Admins count as staff.
- `/counter` (staff only): start a shift with a selfie, end it; server clock. Admin → Shifts lists a
  day's shifts with selfies. Selfies: private bucket `shift-selfies`, owner + admins only.
- Per-store switch `features.inStore` in `tenant.json` (E420 on, 224 off).

**Rollout:** migration `20261125100000_staff_shifts.sql` (also schedules the daily
`purge-shift-selfies` job), deploy the `purge-shift-selfies` function with `--no-verify-jwt`, then
the E420 build; the owner adds the cashier's account in Admin → Staff; test a clock-in on the tablet.
Admins can end anyone's open shift in Admin → Shifts; disabling staff ends theirs.

**Open:**
- Selfie clean-up runs daily: selfies older than 90 days, and uploads no shift uses after a day.
  Not yet seen running (the job calls production; first check after deploy).
- Staff selfies are staff personal information: the owner should tell staff in writing why they are
  taken and how long they are kept (not covered by the customer privacy policy).
- Next: part 2b (stock-take, live dashboard), part 3 (table menu, ordering, ratings, membership QR).

**Part 2a, counter sales (same branch, NOT deployed):** migration `20261125120000_counter_sales.sql`.
Staff on shift ring up sales at `/counter` → Sale: find the customer (name/phone/email) or walk-in,
see their last 10 orders, add items by scanning QR labels (Admin → Products → Print QR labels) or
tapping, cash/card, tick the ID check. Saved as `orders.channel = 'counter'`, already collected and
paid; stock drops. Admin → Orders marks them "In store"; Reports shows online vs in-store.
- **Not checked on screen yet** (browser tool could not load the local site): check a full sale on
  the E420 preview on the tablet before go-live, including camera scanning.
- `npm audit` lists 8 older vulnerabilities in Firebase / React Router dependencies (not from the
  new QR libraries) — worth a separate update pass.

## 8. Resolved

- **2026-11-23 — `.claude/settings.local.json` tracked by git** (was §3.3): untracked and added to
  `.gitignore`; the local file stays. Only the first commit (2026-03-29) ever held it (18 lines, no
  secrets); the admin password in its permission rules was never committed. Prune it locally.
- **2026-11-12 — Drivers added in admin got no email; the driver map looked missing** (§7d):
  PRs #37, #38 and #40.
- **2026-11-09 — PR #15 (owner-alert outcome in `send-order-email`)** (was §2.1): closed unmerged;
  `master` already returns `ownerAlert` since the per-store email work.
- **2026-11-09 — Multi-store "must fix before a second store has an admin"** (§7b): fixed in PR #30.
- **2026-11-09 — Skull Icono T-Shirt** (§7c club input): the club dropped it; hidden on E420
  (`is_available = false`), not deleted.
- **2026-11-09 — Another store's login showing its orders on E420; `/membership` crash** (§7c):
  fixed in PRs #33 and #34, deployed to both sites.

- **2026-10-07 — Supabase outstanding invoices** (was §1.1 ⚠️): paid by the owner.
- **2026-10-07 — Email-only order lookup** (was §2.1): retired by the owner's decision (§7, #13).
- **2026-10-07 — `master` behind the deployed branch** (was §2.2): all work now merges to
  `master` through PRs and production is deployed from it.
- **2026-10-05 — Pre-existing lint errors / missing `docs/DESIGN_SYSTEM.md`** (were §3.2–3.3).
- **2026-10-02 — `RESEND_API_KEY` + verified sending domain.** Receipts and admin alerts deliver
  from `224clubhouse.store`.
- **2026-10-02 — Supabase Auth redirect URLs and custom SMTP.**
- **2026-10-01 — Delivery-only store, EFT, `joints` category, membership-after-first-order,
  password-reset hang, address 224 Rondebult Road, custom domain `224clubhouse.store`.**
- **2026-08-13 / 14 — `is_member_only` enforced, `WELCOME10`, POPIA pages, password reset.**
- **Earlier:** React error boundary, hook error states, oversell (atomic stock), lazy-loaded
  routes, contract tests fail loudly, account-required checkout (2026-08-08; old anonymous orders
  deliberately unlinked and reachable via `/track`).
