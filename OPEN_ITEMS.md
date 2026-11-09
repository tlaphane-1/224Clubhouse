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
- Do one real delivery end to end on a phone before relying on live tracking.
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
bucket `payment-proofs`), the latest driver position (deleted after each delivery round, swept
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
  assigned on Admin → Orders. Map tiles: OpenStreetMap via Leaflet (no key).
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
- **Not yet verified:** a real order on each store (receipt, status email, owner alert), a real
  E420 sign-up confirmation, the membership application on live E420, and the first E420 daily
  summary (07:00, 2026-11-10).
- **Owner to-do:** rotate the auth hook secret (it was pasted in chat): Auth Hooks → generate a new
  secret → Update, then set `SEND_EMAIL_HOOK_SECRET` to match.
- **Club inputs still open:** alert email, Capitec details (EFT stays off), dabs/extract prices,
  names for the two Outdoor grades, own photos, contact email,
  socials, POPIA information officer, membership price. The handover pack is in
  `C:\Users\azgcl\Documents\Explosive420-handover\` (outside the repo).
- **Runbook:** `docs/onboarding/explosive420-go-live.md`.

## 8. Resolved

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
