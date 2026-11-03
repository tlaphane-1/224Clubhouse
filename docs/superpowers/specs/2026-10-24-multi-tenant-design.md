# Multi-tenant design: one codebase, one backend, many clubs

Date: 2026-10-24. Status: draft for owner approval.

## 1. Intent

The owner has a second client who wants exactly what 224 Clubhouse has
(cannabis lounge storefront: shop, memberships, events, cash/EFT delivery
checkout, admin area, driver portal). The owner owns all infrastructure and
wants to **reuse the existing Supabase project and Firebase project** rather
than stand up new ones. Onboarding a client should mean handing over their
details and logos, not building anything.

The one non-negotiable: **the two businesses' data, users, admins and emails
must never clash or cross.** A customer belongs to exactly one business.
No customer of the new business ever receives an email from a 224 address.

Second non-negotiable: **224 Clubhouse (live at 224clubhouse.store) has no
downtime and no behaviour change** while this is built. The final 224 deploy
is an ordinary deploy that can be rolled back in one command.

## 2. Goals, non-goals, anti-goals

### Goals
- A new client is onboarded with one config folder, one provisioning
  command and one deploy command.
- Tenant isolation is enforced in the database (RLS) and in the mail
  pipeline, not just in the UI, and is covered by automated tests that
  fail on any cross-tenant read, write or send.
- Each tenant has its own: domain, hosting site, branding, contact facts,
  bank details, order-number prefix, admin users, drivers, Telegram chat,
  owner-alert email, email sender domain (verified in the shared Resend
  account).
- Adding a store is one provisioning command plus pasting DNS records;
  releasing to every store is one command.
- 224 Clubhouse's current behaviour, URLs, order-number format, storage
  URLs and localStorage keys are preserved exactly.

### Non-goals (explicitly out of scope)
- Per-tenant feature toggles. Both tenants run the same features.
- Per-tenant product categories, delivery fee (R30, free from R500 and for
  members), timezone or currency. These stay as shared constants. If a
  future tenant needs different rules, that is a new project.
  **Exception (2026-11-02):** the minimum age is per tenant
  (`tenants.min_age`; 224 = 21, Explosive 420 = 18), because the owner's
  second store is 18+ (§9).
- One admin login that switches between tenants (owner chose separate
  admins per tenant).
- Allowing one email address to hold accounts at both tenants.
- Enabling online card payment (Paystack) — stays disabled as today.
- A self-service "create tenant" UI. Onboarding is a script run by the
  owner/developer.

### Anti-goals (would make this a failure even if it works)
- Any state in which a 224 customer, order, member, subscriber or admin is
  visible to the other tenant's users or admins, even briefly during
  rollout.
- Any email to the new tenant's customers from `224clubhouse.*`.
- A deploy mistake that puts one tenant's build on the other tenant's site.
- Breaking existing 224 order numbers, image URLs, saved carts or sessions.

## 3. Constraints and facts about the current system

From the 2026-10-24 inventory of the repo:

- No config layer exists. Brand name, address, phone, hours, socials,
  bank details and logo paths are typed into ~60 `src/` files, 11 Edge
  Functions, 7 Auth email templates, 15 migrations and all `scripts/`.
- Order numbers are generated inside `place_cod_order` as `'224-' || …`
  (nine versions of the function across migrations).
- `is_admin()` checks `admin_users where id = auth.uid()`; `is_driver()`
  checks `drivers`. Both are the RLS boundary.
- A trigger `profile_from_signup` on `auth.users` already runs on insert.
- `alert_settings` is a single-row table (`id = 1`) for Telegram; the bot
  token is in Vault as `telegram_bot_token`.
- Two pg_cron jobs call Edge Functions by hard-coded project URL:
  `send-cart-reminders` (hourly) and `send-daily-summary` (05:00).
- Every `send-*` function sends `224 Clubhouse <hello@|orders@MAIL_FROM_DOMAIN>`
  via Resend, fallback domain `224clubhouse.co.za`, `SITE_URL` hard-coded.
- Supabase Auth emails (confirm, recovery, etc.) use project-wide SMTP and
  the 7 templates in `supabase/templates/`.
- Storage buckets `product-images`, `event-images`, `brand-assets`
  (public) and `payment-proofs` (private). Objects live at bucket root.
  `src/hooks/useStorageImages.js` + `scripts/image-manifest.json`
  hard-code the project ref and 19 brand-asset paths.
- Firebase Hosting: one site `224clubhouse` in project `clubhouse-61730`,
  no hosting targets. Firebase RTDB (optional) writes `orders/<orderId>`.
- Vite: no modes, no `loadEnv`; all config via `VITE_*` in `.env.local`.
- localStorage keys: `224-cart`, `age-verified`, `224-vid/sid/src`,
  `224:recent-orders`, `224-driver-install-dismissed`.
- Tailwind palette and fonts are in `tailwind.config.js` / `src/index.css`.
- A Google Maps API key is committed in `src/pages/Contact.jsx:210`.
- `CLAUDE.md` carries a stale heading and Supabase ref from a different
  project.
- 224's Resend setup is partial (receipt email blocked on key/domain per
  `OPEN_ITEMS.md`); interim mail domain history in `tasks/todo.md:124`.

## 4. Design decisions (as decided with the owner)

| Decision | Choice | Decided by |
|---|---|---|
| Backend topology | One Supabase project, one Firebase project, shared by all tenants | Owner |
| Login system | One Supabase Auth; a user belongs to exactly one tenant; a site refuses logins from another tenant | Owner |
| Admins | Separate admin users per tenant; no cross-tenant admin | Owner |
| Email sender | Unique per tenant for every email, including Auth emails | Owner |
| Feature set | Identical for all tenants | Owner |
| Domain | Each tenant brings their own domain (DNS access needed for mail + hosting) | Owner (assumption stated and accepted) |
| Tenant identity | Build-time: one build per tenant, selected by `TENANT=<slug>` | Builder (Claude) |
| Anonymous requests | Tenant sent as a request header; RLS reads it | Builder |
| Storage layout | New objects under `<slug>/` folder in existing buckets; 224's existing root objects grandfathered then copied | Builder |
| Auth emails | Supabase **Send Email Hook** → our Edge Function → tenant's Resend | Builder |
| Secrets per tenant | One shared `RESEND_API_KEY`; Telegram bot token per tenant in Vault (`telegram_bot_token__<slug>`) | Builder |
| Config source of truth | `tenants/<slug>/tenant.json` in the repo; a sync script mirrors it into the `tenants` table | Builder |
| Members across stores | Each store fully independent: an account belongs to exactly one store; no shared logins, no shared members (re-confirmed 2026-10-29 after the shared-login alternative was offered) | Owner |
| Scale target | Design for ~7 stores (224 + Explosive 420 + up to 5 more), not two | Owner |
| People working for several stores | Need a separate email/account per store; the owner uses a different email per store admin | Follows from the above |
| Resend | **One paid Resend account** with one verified domain per store (replaces the earlier "second free account" default, which does not scale); price to be confirmed by owner before phase 3 | Builder, owner to confirm cost |
| Store-editable details | Contact, hours, socials, bank details, About/house-rules/testimonial copy, owner-alert email live in the database and are edited by each store's admin on a Settings page; only build-time items stay in repo config | Builder |

## 5. The design

### 5.1 Tenant identity

A tenant is a short slug, lowercase `[a-z0-9-]`, e.g. `224clubhouse`.
224 Clubhouse's slug is **`224clubhouse`** everywhere.

**Frontend.** `tenants/<slug>/tenant.json` holds everything the site needs
(section 5.2). `tenants/<slug>/assets/` holds logos, hero and gallery
images used at build time (favicon, PWA icons, OG image). The build is
selected by env `TENANT` (defaults to `224clubhouse` so `npm run dev` and
every existing command behave as today). `src/tenant.js` exports the
loaded config as a frozen object; nothing in `src/` imports brand strings
from anywhere else. `tailwind.config.js` reads the tenant's palette and
fonts from the same file so Tailwind tokens (`gold`, `surface`, …) keep
their names and only their values change.

**Database.** A `tenants` table (slug pk, name, order_prefix, site_url,
mail_from_domain, admin_alert_email, timezone, brand/contact/bank JSON,
active). Every tenant-scoped table gets `tenant text not null references
tenants(slug)`. Row-level helper:

```
current_tenant() :=
  coalesce(
    auth.jwt() -> 'app_metadata' ->> 'tenant',        -- signed-in users: authoritative
    nullif(current_setting('request.headers', true)::json ->> 'x-tenant', ''),  -- anon
    default_tenant()                                  -- transition only, see 7
  )
```

For a signed-in user the JWT claim wins and cannot be overridden by the
header. For anonymous traffic the header picks the tenant; anonymous
traffic can only read data that is public anyway (catalogue, events,
tiers, moderated reviews), so a forged header reveals nothing private.
The supabase-js client sets `global.headers['x-tenant'] = TENANT`.

### 5.2 Per-tenant config (`tenant.json`)

The full list of per-store facts is below; the "split" paragraph at the
end of this section decides which live in `tenant.json` and which in the
database.

- `slug`, `name`, `shortName` (admin titles, WhatsApp summaries),
  `legalName`, `tagline`, `heroCopy`, `aboutTimeline[]`, `aboutValues[]`,
  `testimonials[]`, `houseRules[]`, `seoDescriptions{}` per route
- `contact`: street, suburb, city, postalCode, province, phoneDisplay,
  phoneTel, whatsappNumber, email, hoursLine, mapsLink, mapCentre
  `[lat, lng]`, mapEmbedPlaceId (key comes from env)
- `social`: facebook, instagram
- `bank`: multi-line EFT text (shown at checkout and in emails)
- `domain`: `siteUrl`, `liveHosts[]`, `mailFromDomain`
- `orderPrefix` (`224` for 224 Clubhouse), `storagePrefix` (`224` for 224
  so its localStorage keys do not change)
- `theme`: palette tokens (background, surface, gold, goldLight, muted,
  border, leaf, leafDeep, paper…, ink), fonts (heading, body, hand)
- `images`: logo, logoWide, favicon, header, gallery[] — as storage paths
  under `brand-assets/<slug>/` (224 keeps its current root paths)
- `legal`: informationOfficer, companyName, policy effective dates
- `admin`: firstAdminEmail (used only by provisioning)

**Split between build-time and store-editable (scale decision).** Items
are in one of two homes, never both:

- **Repo, `tenants/<slug>/tenant.json` (build-time, developer-owned):**
  slug, name, shortName, orderPrefix, storagePrefix, domain block, theme
  (palette + fonts), image paths, SEO descriptions, legal page content.
  These shape the built bundle or the link previews, so they change only
  with a deploy. The `tenants` table row's copies of these fields are
  written only by `npm run tenant:sync -- <slug>`; a contract test asserts
  row = file.
- **Database, `store_settings` table (runtime, store-admin-owned):**
  contact block, hours line, socials, bank details, tagline/hero copy,
  aboutTimeline, aboutValues, testimonials, houseRules, admin alert email.
  One row per tenant, readable by anon for its own tenant (all fields are
  public except the alert email, which is exposed only to `is_admin()`
  and service role), writable only by that tenant's `is_admin()`. The app
  loads it through a TanStack Query hook (`useStoreSettings`) with
  `tenant.json`-shipped defaults so first paint never waits on it. Edge
  Functions read it for email footers. Provisioning seeds it from an
  optional `tenants/<slug>/settings.seed.json`.
- New admin page `/admin/settings` (follows `docs/DESIGN_SYSTEM.md`,
  layout proposed to owner before building, phone-first).

Functions and SQL read the database; the browser reads `tenant.json`
plus `store_settings`.

### 5.3 Users, tenancy stamp and login

- Signup passes `options.data.tenant = TENANT` (user metadata).
- A `before insert` trigger on `auth.users` copies
  `raw_user_meta_data.tenant` into `raw_app_meta_data.tenant` after
  validating it against `tenants`. Missing tenant → `default_tenant()`
  until phase 6 (today's frontend, `admin-create-driver`,
  `provision-admin.mjs` and the test fixtures don't send one); unknown
  tenant → raise. A raise surfaces as GoTrue's generic "Database error
  saving new user", so friendly messages come from client-side checks.
  `app_metadata` is not user-editable and is included in the JWT, so RLS
  trusts it. The builder must verify on a real signup that the
  BEFORE-trigger write to `raw_app_meta_data` survives GoTrue's own
  post-insert updates; if it doesn't, stamp it from an AFTER trigger or the
  admin API instead. The existing `profile_from_signup` trigger is left
  as is. `admin-create-driver` and `provision-admin.mjs` set
  `app_metadata.tenant` explicitly.
- Backfill: a one-off service-role script stamps every existing
  `auth.users` row with `224clubhouse`. Existing sessions pick up the claim
  on their next token refresh (≤ 1 h); during that hour `default_tenant()`
  keeps them working (section 7).
- Login mismatch: after `signInWithPassword` resolves, `AuthContext`
  compares `user.app_metadata.tenant` with `TENANT`. On mismatch it calls
  `signOut()` immediately and shows "No account with this email at
  <name>. Create an account to continue." The same check runs on initial
  session load and on `onAuthStateChange` (covers a session restored from
  storage). Server side, RLS already yields nothing for that user on this
  site, so the UI check is a courtesy, not the boundary.
- Signup with an email that already exists at the other tenant: Supabase
  returns the normal "already registered" response; the UI message stays
  generic ("This email is already in use. Try signing in or use another
  email.") so it does not reveal which tenant the account belongs to.
- Email address uniqueness across tenants is accepted by the owner.

### 5.4 Admins and drivers

- `admin_users` gains `tenant`; primary key becomes `(id)` still (a user
  is one tenant) with `tenant` not null. `is_admin()` becomes
  `exists (select 1 from admin_users where id = auth.uid() and tenant =
  current_tenant())`. Since the user's JWT tenant is fixed, an admin of
  tenant A evaluates false on tenant B's site and in every B row's policy.
- `drivers` gains `tenant`; `is_driver()` likewise. `admin_becomes_driver`
  and `admin_create_driver` stamp the admin's tenant.
- Provisioning creates the first admin via `scripts/provision-admin.mjs`
  extended with `--tenant <slug>`; the password prefix `Club224!` is
  replaced by a generated password printed once.

### 5.5 Data model changes (all additive)

Tables that get `tenant` (default `current_tenant()`, backfilled to
`224clubhouse`, then `not null`): `products`, `product_variants`,
`product_reviews`, `events`, `event_reservations`, `membership_tiers`,
`memberships`, `orders`, `discount_codes`, `newsletter_subscribers`,
`contact_messages`, `saved_carts`, `site_events`, `customer_profiles`,
`customer_email_prefs`, `drivers`, `driver_locations`, `admin_users`,
`alert_settings`.

Unique constraints become tenant-scoped: `(tenant, slug)` on products and
events, `(tenant, code)` on discount_codes, `(tenant, email)` on
newsletter_subscribers, `(tenant, slug)` on membership_tiers. The old
global uniques (`products.slug`, `newsletter_subscribers.email`,
`membership_tiers.slug`, `discount_codes.code`, and any on events) are
**dropped in the same phase-2 migration**, after the tenant-scoped ones
exist — the old bundle only ever touches 224 rows, so nothing depends on
global uniqueness, and keeping them would block onboarding (tier copy,
`WELCOME10`, shared slugs, shared subscriber emails). Every
`on conflict (...)` in RPCs (e.g. `subscribe_newsletter`) is rewritten
to the tenant-scoped key in the same migration.
`alert_settings` drops the `id = 1` check and is keyed by `tenant`.

Every RLS policy on these tables gains `and tenant = current_tenant()` in
both `using` and `with check`. Every `security definer` RPC that reads or
writes these tables filters on `current_tenant()` and stamps it on
insert; `place_cod_order` uses `tenants.order_prefix` for the order
number. RPCs that take an identifier (`get_order_tracking(order_number)`,
`unsubscribe_newsletter(token)`) additionally require the row's tenant to
equal `current_tenant()`.

A static audit (extension of `scripts/audit-embed-rls.mjs`) lists every
table with a `tenant` column and fails if any policy on it lacks the
tenant predicate, or any RPC body touching it lacks `current_tenant()`.

### 5.6 Storage

Public buckets stay public for reads. Write/delete policies become:
`is_admin() and (storage.foldername(name))[1] = current_tenant()`.
`payment-proofs` keeps its existing `<uid>/<order id>/<file>` layout (paths
are stored in `orders.payment_proof_path`); its policies add a tenant
check through the joined `orders.tenant` row instead of a folder, so no
proof objects move.
Uploads from the app go to `<slug>/<file>`. 224's existing root objects:
copied (not moved) into `224clubhouse/` by a one-off script that also
rewrites `products.image_url`, `events.image_url`, `image-manifest.json`
and `tenant.json`; originals deleted only after the new 224 frontend has
been live for a week. The hard-coded project URL in `useStorageImages.js`
becomes `VITE_SUPABASE_URL` only (no fallback).

### 5.7 Email

**Transactional (our functions).** `_shared/tenant.ts` resolves the tenant
for a request — **always from the database row being acted on** (order,
membership, review, cart), never from the client — and loads its `tenants`
row and `store_settings`. One Resend account holds every store's verified
domain, so there is a single `RESEND_API_KEY`; the sending domain comes
from `tenants.mail_from_domain`, and a store whose domain is not yet
verified is marked `mail_ready = false` so its sends are skipped and
logged rather than falling back to another domain. Sender becomes
`<name> <orders@mailFromDomain>` / `hello@`. Every HTML template takes a
`brand` object (name, logo URL, address, hours, phone, socials, site URL,
palette) instead of literals. Where a function is invoked by the browser
with no row yet (e.g. welcome email on newsletter signup), the tenant
comes from the caller's JWT claim or, for anon, the `x-tenant` header
validated against `tenants`. Until phase 6, a missing header resolves to
`default_tenant()` exactly as in SQL (today's bundle sends none); an
unknown one is rejected.

**Owner alerts** (`ADMIN_ALERT_EMAIL`, Telegram) read
`tenants.admin_alert_email` and the tenant's `alert_settings` row; bot
token from Vault `telegram_bot_token__<slug>`.

**Scheduled jobs.** The two cron entries stay as they are (same project
URL). `send-cart-reminders` and `send-daily-summary` loop over
`tenants where active`, doing today's work once per tenant with that
tenant's sender and recipient. A failure for one tenant is logged and does
not stop the others.

**Auth emails.** New Edge Function `auth-send-email`, registered as the
project's Send Email Hook (verifies the hook's signing secret). Payload
includes the user (with `app_metadata.tenant`), the email type and the
token/links. The function renders the confirm / recovery / email-change /
magic-link / reauth / invite template from `_shared/authEmail.ts` with the
tenant's brand and sends via the tenant's Resend. Unknown tenant → 500
(email not sent) and an owner alert; it never falls back to another
tenant's sender. Once enabled, project SMTP and `supabase/templates/` are
unused; the templates and `scripts/build-auth-email-templates.mjs` are
deleted. Both tenants' domains are added to Auth → Redirect URLs.

Rule enforced by a unit test over the mail layer: **a message's `from`
domain must equal the recipient tenant's `mailFromDomain`**; the test
iterates every send path with a fake Resend and two fake tenants.

### 5.8 Firebase

- Hosting: one Firebase site per store in `clubhouse-61730` (Firebase
  allows up to 36 sites per project — verify current limit). `.firebaserc`
  targets and the `firebase.json` `hosting` array are **generated** from
  the `tenants/` folders by `scripts/gen-firebase-config.mjs` (run by
  every deploy), with identical headers/rewrites and `public:
  dist/<slug>`. Hand edits are not allowed; a test checks the generated
  files match the folder list.
- One build per store, not a single shared bundle, because link previews
  (WhatsApp/OG tags, JSON-LD, sitemap) must be baked per domain and
  Firebase serves identical files on every domain of a site.
- Deploy: `npm run deploy -- <slug>` = account gate check → `TENANT=<slug>
  npm run predeploy` (contract tests + build into `dist/<slug>`) →
  `firebase deploy --only hosting:<slug>`. `npm run deploy -- --all`
  runs the shared contract tests once, builds every active store, runs
  the per-store bundle-isolation check, and deploys all targets in one
  `firebase deploy`; if any build fails, nothing deploys. Deploying with
  neither a slug nor `--all` errors. Preview: `npm run preview:channel --
  <slug|--all>`.
- RTDB is optional and its use on the live build is unconfirmed; there are
  no RTDB rules in the repo. If it is configured: path becomes
  `orders/<slug>/<orderId>`, 224's existing entries are not migrated
  (transient status pushes), and the current console rules are exported
  into a `database.rules.json` before any change. If it is not
  configured, the only change is the path string in `useOrders.js`.

### 5.9 Build pipeline

- `vite.config.js` reads `process.env.TENANT` (default `224clubhouse`),
  loads `tenants/<slug>/tenant.json`, exposes it as a virtual module
  `virtual:tenant`, sets `build.outDir = dist/<slug>`, and copies
  `tenants/<slug>/assets/public/*` (favicon, PWA icons, webmanifest) over
  `public/`.
- `scripts/prerender-seo.mjs` and `scripts/build-driver-icons.mjs` read
  the same config.
- `index.html` title/description are placeholders filled by the Vite
  plugin at build.
- `.env.local` may hold per-tenant overrides as `VITE_<NAME>__<SLUG_UPPER>`;
  the plugin maps them onto plain `VITE_<NAME>` for the selected build.
  Needed for `VITE_WHATSAPP_NUMBER` and `VITE_GOOGLE_MAPS_KEY`.

### 5.10 Tenant provisioning

`npm run tenant:provision -- <slug>` (service role, idempotent):
1. Validates `tenants/<slug>/tenant.json` against a JSON schema.
2. Upserts the `tenants` row and the tenant's `alert_settings` row.
3. Copies 224's `membership_tiers` rows as the tenant's starting tiers
   (owner can edit in admin). Does not copy products, events, discount
   codes or customers.
4. Uploads `tenants/<slug>/assets/brand/*` to `brand-assets/<slug>/`.
5. Creates the first admin user (email from config, generated password)
   and inserts the `admin_users` row.
6. Creates the Firebase site (`firebase hosting:sites:create`) and
   regenerates the hosting config.
7. Adds the store's domain to Resend through its API and the site URL to
   Supabase Auth redirect URLs through the Management API (verify both
   APIs against current docs).
8. Prints one checklist containing every DNS record to add at the
   store's domain registrar (Resend mail records + Firebase custom-domain
   records), then the remaining manual steps (Telegram chat, optional).
   Re-running the command shows which steps are done and which DNS
   records still fail verification, and flips `mail_ready` when Resend
   reports the domain verified.

The owner's work per new store is: fill `tenant.json` + optional
settings seed, drop logos into `tenants/<slug>/assets/`, run provision,
paste the printed DNS records, run provision again, preview, deploy.

### 5.11 Tests (added to `predeploy`)

- **Tenant isolation contract test** (live DB, anon key + two provisioned
  test users, one per tenant, plus one admin per tenant): for every
  tenant-scoped table, user A sees only A rows; admin A sees only A rows;
  inserting with the other tenant's slug is rejected; `get_order_tracking`
  for a B order returns nothing on site A. Negative controls per the
  global test standard.
- **Login mismatch test** (vitest, mocked supabase): a session whose
  `app_metadata.tenant` differs from `TENANT` is signed out and the
  message shown.
- **Mail sender test**: described in 5.7.
- **Config/row parity test**: `tenants` row equals `tenant.json`.
- **Static tenant audit**: described in 5.5.
- **Build smoke**: `TENANT=<each>` build succeeds and the bundle contains
  no string from the other tenant's `name`/`domain` (greps `dist/<slug>`).
- Existing contract suites updated to filter by tenant and to use
  `tenants.order_prefix` instead of literal `224-`.

## 6. Hygiene fixed alongside (small, independent)

- Move the committed Google Maps key to `VITE_GOOGLE_MAPS_KEY`; owner
  restricts it to the live hosts in Google Cloud (and rotates if desired).
- Fix `CLAUDE.md`: remove the EFF heading and wrong project ref; add the
  multi-tenant deploy rule ("never deploy without a slug").
- Replace `scripts/provision-admin.mjs` fixed password prefix with a
  generated password.

## 7. Rollout with zero 224 downtime

Each phase ends with 224 verified unchanged. Phases 1–4 can be merged and
deployed to 224 independently; each is a normal deploy.

0. **Hygiene** (section 6). Deploy 224. Nothing user-visible changes.
1. **Config extraction, frontend only.** Create `tenants/224clubhouse/`,
   the Vite plugin, `src/tenant.js`; replace every literal in `src/`,
   `index.html`, `public/`, `scripts/prerender-seo.mjs`,
   `build-driver-icons.mjs`. Build-output diff against the previous build
   must show only hashed filenames. Deploy 224 via a preview channel first,
   then live.
2. **Database, additive.** One migration: `tenants` table seeded with
   `224clubhouse`; `default_tenant()` returning `'224clubhouse'`;
   `current_tenant()`; `tenant` columns added **nullable with default
   `current_tenant()`**, backfilled, then set `not null`; tenant-scoped unique
   constraints added and the old global ones dropped (5.5); policies and RPCs rewritten with
   the tenant predicate; `is_admin()`/`is_driver()` tenant-aware; signup
   trigger; order prefix from `tenants`. Run the auth backfill script.
   Because `default_tenant()` resolves every request without a claim or
   header to `224clubhouse`, the **currently deployed 224 frontend keeps
   working unchanged** — it just doesn't know it's a tenant yet. Verify
   with the existing contract suites (updated) and manual smoke on live.
3. **Functions and mail.** Deploy tenant-aware Edge Functions (they
   resolve `224clubhouse` from rows as before). Deploy `auth-send-email`,
   test by signing up a throwaway 224 user **before** flipping the hook in
   the dashboard; flip; sign up another; confirm the email arrives from
   224's domain; keep SMTP settings in place for a week as the rollback.
4. **Build/deploy per tenant.** Hosting targets, `deploy` script, `x-tenant`
   header, tenant stamp on signup, login-mismatch check, `storagePrefix`.
   Deploy 224 via preview channel, then live. Now 224 is a fully-fledged
   tenant.
5. **Onboard the new client.** `tenant:provision`, owner completes the
   manual checklist, deploy to a preview channel, owner and client review
   on phones (390/360 px), then `deploy -- <slug>` to the live site and
   attach the custom domain.
6. **Remove the training wheels.** After both tenants have run two weeks:
   migration drops `default_tenant()` from `current_tenant()`, the signup
   trigger and `_shared/tenant.ts` (missing tenant → no rows / rejected),
   deletes
   root-level storage originals, deletes `supabase/templates/`. This is
   the only step that could affect an old cached 224 bundle, which is why
   it waits.

Rollback at any phase: redeploy the previous Firebase release (`firebase
hosting:rollback`); database changes are additive so the old frontend
keeps working through phase 5. Phase 6 is the point of no return and is
done deliberately.

## 8. Left to the builder

- Exact JSON schema and file layout under `tenants/<slug>/`.
- Whether the virtual module is a Vite plugin or a resolved alias.
- Order of literal replacement in `src/` and how to chunk it into PRs
  (suggest: layout/legal, store/checkout, admin, driver, scripts).
- Edge Function template refactor shape (one `renderShell(brand, body)`
  is suggested).
- Hook payload verification details per Supabase's Send Email Hook docs
  (verify against current docs, not memory; confirm hook availability on
  the project's plan before phase 3).
- Test fixture strategy for a second tenant in the live-DB suites
  (suggest a permanent `test-tenant` row, inactive, cleaned by
  `globalSetup`).
- How `prerender-seo.mjs` handles per-tenant sitemaps/robots (one per
  `dist/<slug>`).

## 9. Second store: Explosive 420 Cannabis Social Club

- Slug `explosive420`; suggested order prefix `E420` (owner to confirm);
  `storagePrefix` `e420`.
- Logo supplied 2026-10-29 (saved at
  `C:\Users\azgcl\.claude\uploads\aaa0e6b9-abab-4153-a656-9f171f372757\c0cdcb1b-image.jpg`,
  to be copied into `tenants/explosive420/assets/` in phase 5): a tall
  detailed illustration, green/yellow/red on black. Theme: keep the dark
  background/surface tokens; derive accent tokens (replacing 224's gold
  and leaf) from the logo's yellow, green and red, checked for contrast on
  `#0a0a0a`. Still needed: a wide logo with the name (navbar) and a simple
  square icon (favicon, driver PWA). If the store has none, the builder
  produces drafts from the supplied image for owner approval.

## 10. Owner inputs needed before phase 5

- New client's `tenant.json` content: name, legal name, address, phone,
  WhatsApp number, support email, hours, socials, bank details, copy for
  About/house rules/testimonials, domain name.
- Logos (square + wide), header image, gallery images.
- Approval of the Resend paid plan cost (one account, all stores) and DNS
  access to the store's domain.
- First admin email address.

## 11. Phase 2 amendments (2026-11-02, from the schema inventory)

Builder rulings made while planning phase 2. Each one keeps 224 unchanged.

- **Minimum age per tenant.** `tenants.min_age` (224 = 21). Every SQL age
  rule reads it: `place_cod_order`, `place_membership`,
  `admin_create_membership`, `set_date_of_birth`, `my_age_verified` and the
  `profile_from_signup` writer. Messages keep the form
  "Must be <n> or older", so 224's text is unchanged. The consent key
  `age_21` stays accepted; `age_min` is the new key that phase 4 sends.
  Frontend age copy moves to config in phase 4.
- **User-keyed tables keep `user_id` as their primary key.** These are
  saved_carts, customer_profiles, customer_email_prefs, drivers,
  driver_locations and admin_users. A user belongs to exactly one tenant
  (§4), so one row per user is still correct. The tables still get
  `tenant` so admin policies and service jobs can scope them.
- **`orders.order_number` stays globally unique.** Prefixes differ per
  tenant, and `get_order_tracking` also requires the tenant to match.
- **Auth backfill runs inside the migration** (`update auth.users set
  raw_app_meta_data = … || '{"tenant":"224clubhouse"}'`). This replaces the
  service-role script in §5.3: it is atomic and can be rehearsed locally.
- **The `tenants` table starts minimal:** slug, name, order_prefix,
  min_age, active and created_at. Phase 3 adds the mail columns. Contact
  and brand JSON go in `store_settings` later, as per §4.
- **Storage folder scoping (`<slug>/` uploads) moves to phase 4**, together
  with the frontend change that uploads there. Phase 2 storage changes:
  `is_admin()` becomes tenant-aware, and `payment-proofs` gets the
  `orders.tenant` check. `is_admin()` does NOT scope image uploads: it only
  proves the caller is an admin of the caller's own store, and image object
  paths are not store-prefixed, so any store's admin can still upload or
  delete any product/event image until phase 4 (see the list below).
- **Telegram vault secret name:** `telegram_bot_token` stays as 224's
  name. Other tenants use `telegram_bot_token__<slug>`, resolved by one
  helper function.
- **Edge Functions are untouched in phase 2.** They run as the service
  role with no header, so `current_tenant()` resolves to `default_tenant()`
  (224). Phase 3 makes them send `x-tenant` per store.
- **Rehearsal database.** Every phase-2 migration is applied and tested
  first on a local Supabase stack (Docker). It is pushed to production
  only after the owner's go-ahead.
- **Security fix carried in phase 2:** `decrement_stock` (unused,
  SECURITY DEFINER) is still executable by every signed-in user. It is
  dropped.
- **`current_tenant()` ignores the header for signed-in users.** A
  signed-in user's tenant comes only from the JWT claim; without one it is
  `default_tenant()`, never the `x-tenant` header; an empty claim counts as
  absent. The header applies only when `auth.uid()` is null (anon and the
  service role). This amends §5.1.
- **Must fix before a second store has an admin** (found in the phase-2
  final review; also tracked in `OPEN_ITEMS.md` §7a):
  - `product-images` / `event-images` admin upload and delete are
    cross-store until phase 4 store-prefixes the object paths.
  - A child row can point at another store's parent (e.g. a store-B
    `product_variants` row on a 224 product id). Add composite FKs or check
    triggers before phase 5.
  - `supabase/functions/telegram-connect` calls `store_telegram_token` /
    `set_telegram_chat` as the service role with no `x-tenant`, so a store-B
    admin would overwrite 224's Telegram token and chat. Phase 3 must forward
    the tenant.
  - A service-role `auth.admin.createUser` that passes any `app_metadata`
    must include `tenant` in it (GoTrue replaces the stamp). Applies to the
    phase 3/5 callers `admin-create-driver` and `scripts/provision-admin.mjs`.
