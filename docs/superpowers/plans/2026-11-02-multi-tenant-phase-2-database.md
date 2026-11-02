# Multi-tenant Phase 2: Database Tenancy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every store's data, admins and drivers are separated inside the shared Supabase database by a `tenant` column and RLS. 224's live site keeps working unchanged throughout.

**Architecture:** A `tenants` table and a `current_tenant()` function resolve the tenant in this order: the JWT `app_metadata.tenant` (signed-in users), then the `x-tenant` request header (anonymous visitors and service jobs), then `default_tenant()` = `224clubhouse` (transition only). Every tenant table gets `tenant text not null default current_tenant()`. Every policy and every SECURITY DEFINER RPC filters on it. Nothing the deployed 224 frontend calls changes signature, so today's bundle keeps working. All work is rehearsed on a local Supabase stack (Docker) and pushed to production only in the last task, after the owner's go-ahead.

**Tech Stack:** Supabase Postgres 15 (RLS, plpgsql, pg_cron, Vault), Supabase CLI 2.98, Docker, Vitest 4 live-DB contract suites, Node 24.

**Spec:** `docs/superpowers/specs/2026-10-24-multi-tenant-design.md`. Phase 2 is in §7. Data model is §5.1, §5.3–5.6 and §5.11. **§11 holds the phase-2 amendments and overrides earlier sections where they differ.**

**Schema facts:** the inventory of all 19 tables, 52 policies, 58 functions, 6 triggers and 5 cron jobs, with file:line pointers, is at `docs/superpowers/plans/2026-11-02-phase-2-schema-inventory.md`. Every task reads the sections it touches. The final definition of each function is the one at the file:line given there.

## Global Constraints

- **224 must not change.** Every existing contract suite in `src/__tests__/*.contract.test.js` passes unmodified after every task. Existing assertions, including `/^224-/`, stay as they are. Only `src/__tests__/helpers/liveFixtures.js` may gain new exports.
- **The live frontend bundle keeps working.** No RPC that `src/` or an Edge Function calls changes its name, arguments, return shape or grants. Change bodies with `create or replace` only.
- **Migrations are additive.** New files only, named `supabase/migrations/20261102HHMMSS_<name>.sql`. Each one leaves 224 fully working on its own, because a push can stop between files.
- **Production is untouched until Task 11.** Run every migration and test against the local stack via `npm run test:local`. Never run `supabase db push`, `supabase db reset --linked`, or any write to the linked project before Task 11.
- **Policy predicate:** use `tenant = (select public.current_tenant())`, wrapped in `select` so it runs once per statement, not once per row. Use it in `using`, and in `with check` for every policy that writes.
- **Column shape:** `tenant text not null default public.current_tenant() references public.tenants(slug)`. Every table gets an index whose first column is `tenant`; a tenant-scoped unique index counts.
- **SECURITY DEFINER functions:** keep `set search_path = public` and their existing grants. Inside, filter every read and stamp every write with `public.current_tenant()`, held once in a variable `v_tenant`.
- **Test tenant:** slug `vitest-b`, name `Vitest B`, order_prefix `VTB`, min_age `18`, active `false`. Test helpers create it. It is never added by a migration.
- **Secrets:** never read `.env*`. Local keys come from `supabase status`. Never print keys.
- **Commits:** imperative mood, `feat(db): …` / `test(db): …`, with the session trailer lines.

## Review Focus

1. **Old session without a tenant claim.** A signed-in 224 user whose JWT predates the backfill still sees their own orders and can check out, because `default_tenant()` covers them. Pinned in Task 5.
2. **Forged `x-tenant` header from a signed-in user.** The JWT tenant wins: a 224 admin who sends `x-tenant: vitest-b` still sees only 224 rows. Pinned in Task 5.
3. **Anonymous insert naming another tenant.** A newsletter or contact insert whose `tenant` value differs from the header is rejected. Pinned in Task 5.
4. **Same slug, code or email in two stores.** Both rows are allowed. `validate_discount_code('WELCOME10')` returns each store's own code. Pinned in Tasks 4 and 6.
5. **The age limit follows the store.** A 19-year-old date of birth is accepted at `vitest-b` (18) and rejected at 224 with the unchanged message "Must be 21 or older". Pinned in Tasks 3 and 7.

---

### Task 1: Local rehearsal stack and drift check

**Files:**
- Create: `supabase/config.toml` (via `supabase init`; keep defaults except `project_id = "224clubhouse"`)
- Create: `scripts/test-local.mjs`
- Modify: `package.json` (add `"test:local": "node scripts/test-local.mjs"`)
- Exists already: `docs/superpowers/plans/2026-11-02-phase-2-schema-inventory.md`

**Interfaces:**
- Produces: `npm run test:local -- <vitest args>`. It runs vitest against the local stack, with `SUPABASE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` set from `supabase status -o json`. It exits 2 with a message if the stack is down or the API URL host is not `127.0.0.1` or `localhost`.

- [ ] **Step 1:** Run `supabase init`, set `project_id`, then `supabase start`. Expected: the stack starts and all 30 migrations apply cleanly. If one fails, stop and report: it means the repo migrations don't rebuild the schema.
- [ ] **Step 2:** Write `scripts/test-local.mjs`. Parse `supabase status -o json` for the API URL and the anon and service keys. Refuse non-local hosts. Spawn `npx vitest run` with the forwarded args and env, and exit with vitest's code. `test/loadEnv.mjs` lets process.env win over `.env.local`, so no change is needed there.
- [ ] **Step 3:** In local SQL, unschedule the two http cron jobs (`select cron.unschedule('send-cart-reminders'); select cron.unschedule('send-daily-summary');`) so the local stack never calls production Edge Functions. Make `test-local.mjs` do this idempotently before each run.
- [ ] **Step 4:** Baseline: `npm run test:local -- src/__tests__/*.contract.test.js src/__tests__/rlsEmbedAudit.test.js`. Expected: every suite runs (none skipped for missing keys) and passes. Record the counts in the report. Fix test-harness problems only; any other red stops the task.
- [ ] **Step 5:** Drift check (read-only on production):
  - Run `supabase migration list --linked`. Expected: local and remote list the same 30 versions.
  - Run `supabase db dump --linked --schema public -f <scratchpad>/live-schema.sql` and `supabase db dump --local --schema public -f <scratchpad>/local-schema.sql`, then diff them. Record every difference in the report. Differences in functions, policies or constraints are blocking: report them, don't fix them.
  - If `db dump --linked` asks for a database password, report NEEDS_CONTEXT. The owner supplies it with a `!` command.
- [ ] **Step 6:** Commit `supabase/config.toml`, `scripts/test-local.mjs`, and `package.json`. Add `supabase/.temp/` and `supabase/.branches/` to `.gitignore` if `init` didn't.

### Task 2: Drop `decrement_stock`

**Files:**
- Create: `supabase/migrations/20261102100000_drop_decrement_stock.sql`
- Test: `src/__tests__/tenancy.contract.test.js` (new file; later tasks append `describe` blocks)

- [ ] **Step 1: Failing test.** `describe('decrement_stock is gone')`: a signed-in test user calling `rpc('decrement_stock', { product_id: <fixture product>, qty: 1 })` gets an error with code `PGRST202`, and the product's `stock_quantity` is unchanged. Use the existing `createTestUser` / product fixture helpers.
- [ ] **Step 2:** `npm run test:local -- src/__tests__/tenancy.contract.test.js`. Expected: FAIL (the call succeeds).
- [ ] **Step 3:** Migration: `drop function if exists public.decrement_stock(uuid, integer);`. First grep that nothing in `src/`, `supabase/functions/` or `scripts/` calls it.
- [ ] **Step 4:** Run `supabase migration up --local`, then the test (PASS) and the full baseline from Task 1 Step 4 (PASS).
- [ ] **Step 5:** Commit `fix(db): drop decrement_stock, executable by any signed-in user`.

### Task 3: Tenant core

**Files:**
- Create: `supabase/migrations/20261102110000_tenancy_core.sql`
- Modify: `src/__tests__/helpers/liveFixtures.js` (new exports only)
- Test: `src/__tests__/tenancy.contract.test.js`

**Interfaces:**
- Produces (SQL):
  - Table `public.tenants(slug text pk check (slug ~ '^[a-z0-9-]{2,40}$'), name text not null, order_prefix text not null unique check (order_prefix ~ '^[A-Z0-9]{2,6}$'), min_age int not null check (min_age between 18 and 25), active boolean not null default true, created_at timestamptz not null default now())`. Seed `('224clubhouse','224 Clubhouse','224',21,true)`. RLS on, with `tenants_public_select for select using (true)`. There are no write policies; the service role writes.
  - `public.default_tenant() returns text language sql stable` → `'224clubhouse'`.
  - `public.current_tenant() returns text language sql stable`, exactly as spec §5.1: `coalesce(auth.jwt()->'app_metadata'->>'tenant', nullif(current_setting('request.headers', true)::json->>'x-tenant',''), public.default_tenant())`. The `request.headers` setting may be unset or empty outside PostgREST, so guard it with `nullif(current_setting(...), '')` before casting.
  - `public.tenant_min_age() returns int` (the current tenant's `min_age`).
  - `public.tenant_order_prefix() returns text`.
  - Probe `public.tenancy_applied() returns boolean` (immutable, `select true`), granted to anon and authenticated, as the existing probes are.
  - Grant execute on `current_tenant`, `default_tenant`, `tenant_min_age` and `tenant_order_prefix` to anon and authenticated.
- Produces (JS, in `liveFixtures.js`):
  - `TEST_TENANT = 'vitest-b'`.
  - `ensureTestTenant(admin)`: upserts the test tenant row (Global Constraints values).
  - `tenantClient(slug)`: an anon client with `global.headers['x-tenant'] = slug`.
  - `createTenantUser(admin, label, tenant)`: like `createTestUser`, but sets `app_metadata: { tenant }` and gives an adult profile.
  - `signInClient(email, password, { tenant })`: a signed-in client, optionally sending an `x-tenant` header.
  - Read the existing `createTestUser` and sign-in helpers first, and reuse their shape.

- [ ] **Step 1: Failing tests,** in `describe('tenancy core')`, gated on `probeMigration('tenancy_applied', '20261102110000_tenancy_core')`:
  - anon with no header → `rpc('current_tenant')` = `'224clubhouse'`
  - `tenantClient('vitest-b')` → `'vitest-b'`
  - a signed-in user whose app_metadata tenant is `vitest-b`, sending header `224clubhouse` → `'vitest-b'`
  - `rpc('tenant_min_age')` = 21 for anon with no header and 18 for `tenantClient('vitest-b')`
  - `rpc('tenant_order_prefix')` = `'224'` for anon with no header
  - anon `from('tenants').insert(...)` fails
- [ ] **Step 2:** Run the test. Expected: the suite is skipped as "not applied" (the gate works), and FAILs once the probe exists.
- [ ] **Step 3:** Write the migration and helpers.
- [ ] **Step 4:** Run `supabase migration up --local`, the tenancy suite (PASS) and the full baseline (PASS).
- [ ] **Step 5:** Commit `feat(db): tenants table and current_tenant()`.

### Task 4: Tenant columns and tenant-scoped uniques

**Files:**
- Create: `supabase/migrations/20261102120000_tenant_columns.sql`
- Test: `src/__tests__/tenancy.contract.test.js`

**Interfaces:**
- Consumes: Task 3 (`tenants`, `current_tenant()`).
- Produces: `tenant` on all 19 tables listed in the spec, §5.5. New unique constraints:
  - `products (tenant, slug)` named `products_tenant_slug_key`
  - `membership_tiers (tenant, slug)` named `membership_tiers_tenant_slug_key`
  - `discount_codes (tenant, code)` named `discount_codes_tenant_code_key`
  - `newsletter_subscribers (tenant, email)` named `newsletter_subscribers_tenant_email_key`
  - Dropped: `products_slug_key`, `membership_tiers_slug_key`, `discount_codes_code_key` and `newsletter_subscribers_email_key`. All other uniques stay.
  - `alert_settings`: drop the `id = 1` check and the primary key on `id`. `tenant` becomes the primary key; keep the `id` column (nullable, no default) so old selects still parse.

- [ ] **Step 1: Failing tests,** in `describe('tenant columns')`:
  - each of the 19 tables answers `select('tenant').limit(1)` with the service role, with no error
  - a product inserted by the service role with no tenant gets `224clubhouse`
  - the service role can insert two products with the same slug, one per tenant (`224clubhouse` and `vitest-b`); a second `224clubhouse` product with that slug fails with code `23505`
  - the same holds for `discount_codes.code` and `newsletter_subscribers.email`
  - `rpc('subscribe_newsletter', { p_email })` on the default tenant still returns success twice for the same email (the upsert path still works)
  - Clean up every fixture row you create, using the existing prefixes.
- [ ] **Step 2:** Run. Expected: FAIL (`column tenant does not exist`).
- [ ] **Step 3:** Migration. For each table:
  - `add column tenant text default public.current_tenant() references public.tenants(slug)`; existing rows take the default, so they are backfilled to `224clubhouse`
  - then `alter column tenant set not null`
  - then the index
  
  Add the new uniques **before** dropping the old ones. In the same file, `create or replace` `subscribe_newsletter` with `on conflict (tenant, email)` and `tenant` stamped to `public.current_tenant()`, keeping its signature.
- [ ] **Step 4:** Run `supabase migration up --local`, the tenancy suite (PASS) and the full baseline (PASS). The baseline matters most here: it proves the old code paths still work against tenant-scoped uniques.
- [ ] **Step 5:** Commit `feat(db): tenant column on every store table`.

### Task 5: Tenant-aware `is_admin`, `is_driver` and every policy

**Files:**
- Create: `supabase/migrations/20261102130000_tenant_policies.sql`
- Test: `src/__tests__/tenancy.contract.test.js`

**Interfaces:**
- Consumes: Tasks 3 and 4.
- Produces:
  - `is_admin()` is `exists (select 1 from admin_users where id = auth.uid() and tenant = public.current_tenant())`, still SECURITY DEFINER, stable and no-arg.
  - `is_driver()` is the same pattern on `drivers` (`active` as today).
  - Each of the 42 public policies is recreated with the tenant predicate, keeping its name, command and roles. The list is in inventory §2.
  - Open policies:
    - `using (true)` becomes `using (tenant = (select public.current_tenant()))`
    - `membership_tiers_public_select` becomes `is_active and tenant = (select …)`
    - the anon inserts `newsletter_public_insert` and `contact_public_insert` get `with check (tenant = (select public.current_tenant()))`
  - Storage: the four `payment_proofs_*` policies add `exists (select 1 from public.orders o where o.id::text = (storage.foldername(name))[2] and o.tenant = (select public.current_tenant()))`; the owner insert policy merges this into its existing exists clause. The product-images and event-images admin policies need no change, because `is_admin()` now scopes them.

- [ ] **Step 1: Failing tests,** in `describe('tenant isolation — tables')`. Setup:
  - `ensureTestTenant`
  - one 224 customer and one `vitest-b` customer, each with one order created by the service role with their tenant
  - one admin per tenant: an `admin_users` row with that tenant
  - one product per tenant
  
  Assert:
  - anon with no header sees the 224 product and not the vitest-b product; `tenantClient('vitest-b')` sees the opposite
  - each customer sees only their own order
  - the 224 admin sees the 224 order and not the vitest-b order, and the vitest-b admin sees the opposite
  - the 224 admin sending header `x-tenant: vitest-b` still sees no vitest-b order (Review Focus 2)
  - `rpc('is_admin')` is true for each admin and false for the other tenant's admin
  - anon `tenantClient('224clubhouse')` inserting into `contact_messages` with `tenant: 'vitest-b'` fails; the same insert with no tenant succeeds (Review Focus 3); the same pair for `newsletter_subscribers`
  - a 224 user created with app_metadata `{}` (no tenant: an old session) can read their own 224 order (Review Focus 1)
  - **negative control:** the vitest-b admin's `update` on the 224 product changes 0 rows
- [ ] **Step 2:** Run. Expected: FAIL on cross-tenant visibility.
- [ ] **Step 3:** Write the migration. Use `drop policy if exists` then `create policy` for each, inside one file.
- [ ] **Step 4:** Run `supabase migration up --local`, the tenancy suite (PASS) and the full baseline (PASS).
- [ ] **Step 5:** Commit `feat(db): tenant predicate on every policy`.

### Task 6: Tenant-aware RPCs (orders, discounts, reviews, products, drivers)

**Files:**
- Create: `supabase/migrations/20261102140000_tenant_rpcs_orders.sql`
- Test: `src/__tests__/tenancy.contract.test.js`

**Interfaces:**
- Consumes: Tasks 3–5.
- Functions, from their final definitions in inventory §3 (signatures unchanged):
  - `place_cod_order`
  - `get_order_tracking`
  - `admin_update_order_status`
  - `attach_payment_proof`
  - `admin_set_eft_payment`
  - `discount_eval`, `validate_discount_code`
  - `has_delivered_purchase`, `my_review_status`, `submit_product_review`, `get_product_reviews`
  - `sync_product_totals`, `sync_product_from_variants`
  - `admin_assign_driver`, `admin_driver_locations`
  - `driver_start_delivery`, `driver_complete_delivery`, `driver_update_location`
  - `get_delivery_location`
  - `admin_becomes_driver`
- Rules:
  - Every `select` / `update` / `delete` on a tenant table adds `tenant = v_tenant`, and every `insert` sets `tenant = v_tenant`.
  - Lookups by user id ("first order", "membership required after first order", member gates) count only the current tenant's rows.
  - `place_cod_order`:
    - the order number is `public.tenant_order_prefix() || '-' || <existing suffix logic>`, so 224 still produces `224-…`
    - the age check uses `public.tenant_min_age()`, with message `format('Age check: …%s…', min_age)`; for 224 the text must stay identical to today's
    - `products` and `product_variants` locks stay as they are, plus the tenant filter
  - `get_order_tracking` and `get_delivery_location` return nothing for an order whose tenant ≠ `current_tenant()`.

- [ ] **Step 1: Failing tests,** in `describe('tenant isolation — orders and discounts')`:
  - a `vitest-b` customer placing an order for a `vitest-b` product gets an order number matching `/^VTB-/`, and a 224 customer still gets `/^224-/`
  - a `vitest-b` customer ordering a 224 product id gets an error and no order row
  - `get_order_tracking` for the vitest-b order, called via the 224 anon client, returns null or empty; via `tenantClient('vitest-b')` it returns the order
  - `WELCOME10`-style: a code `VITEST-SAME` exists in both tenants with different values; each tenant's customer validates and gets their own value (Review Focus 4)
  - the 224 admin calling `admin_update_order_status` on the vitest-b order gets the "not admin" or "not found" error, and the row is unchanged
  - a `vitest-b` customer aged 19 can place an order; a 224 customer aged 19 gets the 224 age message (Review Focus 5, order path)
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Write the migration. For each function, copy the final definition from the file:line in the inventory and change only what the rules require.
- [ ] **Step 4:** Run `supabase migration up --local`, the tenancy suite (PASS) and the full baseline (PASS).
- [ ] **Step 5:** Commit `feat(db): tenant-scoped order, discount, review and driver RPCs`.

### Task 7: Tenant-aware RPCs (memberships, events, newsletter, carts, analytics, age, alerts)

**Files:**
- Create: `supabase/migrations/20261102150000_tenant_rpcs_members.sql`
- Test: `src/__tests__/tenancy.contract.test.js`

**Interfaces:**
- Consumes: Tasks 3–6.
- Functions (signatures unchanged):
  - `place_membership`, `admin_update_membership_status`, `admin_create_membership`, `admin_link_membership_user`
  - `event_seats_remaining`, `reserve_event_seats`, `admin_update_reservation_status`
  - `unsubscribe_newsletter`
  - `stop_cart_reminders`, `claim_cart_reminders`, `release_cart_reminders`
  - `track_event`, `site_analytics`
  - `set_date_of_birth`, `my_age_verified`, `profile_from_signup`
  - `daily_summary_data`, `admin_daily_summary`
  - `admin_get_alert_settings`, `admin_update_alert_settings`
  - `store_telegram_token`, `set_telegram_chat`, `telegram_config`
- Rules:
  - The same filter and stamp rules as Task 6.
  - Tier lookups by slug use `(tenant, slug)`.
  - Age:
    - every `interval '21 years'` becomes `make_interval(years => public.tenant_min_age())`
    - messages become `format('Must be %s or older', …)`
    - `profile_from_signup` reads the new user's tenant from `new.raw_app_meta_data->>'tenant'`, falling back to `default_tenant()`, and uses that tenant's `min_age`
    - `place_membership` accepts consent key `age_21` **or** `age_min`
  - Signup counts in `site_analytics` and `daily_summary_data` use `coalesce(u.raw_app_meta_data->>'tenant', public.default_tenant()) = v_tenant`.
  - Alerts:
    - `alert_settings` reads and writes go by `tenant = v_tenant`
    - the vault name is `public.telegram_secret_name(v_tenant)`, a new SQL function: `'telegram_bot_token'` for `224clubhouse`, otherwise `'telegram_bot_token__' || slug`
    - `admin_get_alert_settings` returns the defaults (as today's seeded row) when the tenant has no row
    - the migration inserts no row for `vitest-b`

- [ ] **Step 1: Failing tests,** in `describe('tenant isolation — members, events, alerts')`:
  - a `vitest-b` tier slug `daily` coexists with 224's `daily`; `place_membership` by a vitest-b customer for `daily` uses the vitest-b tier's price
  - `set_date_of_birth` with a date 19 years ago: OK at `vitest-b`; error matching `/21 or older/` at 224 (Review Focus 5)
  - the 224 admin's `admin_get_alert_settings` returns 224's settings; the vitest-b admin gets the defaults and never sees 224's chat id
  - `site_analytics` for the vitest-b admin doesn't count 224 page views (seed one `track_event` per tenant)
  - `reserve_event_seats` by a vitest-b customer on a 224 event fails
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Write the migration (same method as Task 6).
- [ ] **Step 4:** Run `supabase migration up --local`, the tenancy suite (PASS) and the full baseline (PASS). Also: `ageVerification.contract.test.js`, `membership.contract.test.js` and `telegramAlerts.contract.test.js` must still pass unmodified.
- [ ] **Step 5:** Commit `feat(db): tenant-scoped membership, event, cart, analytics and alert RPCs`.

### Task 8: Stamp the tenant on signup and backfill existing users

**Files:**
- Create: `supabase/migrations/20261102160000_tenant_signup_stamp.sql`
- Test: `src/__tests__/tenancy.contract.test.js`

**Interfaces:**
- Produces:
  - Trigger `on_auth_user_tenant`: `before insert on auth.users`, running `public.stamp_user_tenant()` (SECURITY DEFINER, execute revoked from public, anon and authenticated). It sets `new.raw_app_meta_data = coalesce(new.raw_app_meta_data,'{}') || jsonb_build_object('tenant', t)`, where `t` is `new.raw_user_meta_data->>'tenant'` validated against `tenants`. A missing tenant gives `default_tenant()`. An unknown tenant raises `'unknown tenant'`.
  - An app_metadata tenant that is already set is kept (admin API creates).
  - Backfill: `update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data,'{}') || '{"tenant":"224clubhouse"}' where raw_app_meta_data->>'tenant' is null`.

- [ ] **Step 1: Failing tests,** in `describe('signup tenant stamp')`:
  - anon `auth.signUp({ email, password, options: { data: { tenant: 'vitest-b' } } })` → the service role's `auth.admin.getUserById` shows `app_metadata.tenant === 'vitest-b'` (spec §5.3: this proves GoTrue doesn't overwrite the BEFORE-trigger write)
  - signup with no tenant → `'224clubhouse'`
  - signup with `tenant: 'nope'` → error, and no user created
  - signup with tenant `vitest-b` and a date of birth 19 years ago → a `customer_profiles` row exists (the `profile_from_signup` path at min age 18)
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Write the migration. If the Step 1 GoTrue assertion fails after the trigger exists, switch to an AFTER INSERT trigger that `update`s `auth.users` for `new.id`, and note it in the report.
- [ ] **Step 4:** Run `supabase migration up --local`, the tenancy suite (PASS) and the full baseline (PASS).
- [ ] **Step 5:** Commit `feat(db): stamp tenant on signup, backfill existing users`.

### Task 9: Static tenant audit

**Files:**
- Create: `scripts/audit-tenant-rls.mjs`
- Create: `src/__tests__/tenantAudit.unit.test.js`
- Modify: `package.json` (add the test to `test:contract` and `predeploy`)

**Interfaces:**
- Produces: `node scripts/audit-tenant-rls.mjs [--json]` → `{ tables, problems: [{ kind, name, file, line, detail }] }`, exiting 1 when there are problems. Exported pure functions for the unit test:
  - `splitStatements(sql)`: splits on `;` outside `$…$` bodies and quotes
  - `finalState(files)`: applies create/drop for policies, functions and triggers in filename order, and returns the final policy and function maps
  - `audit(finalState)`

**Rules:**
- **Tenant tables** are those that gain `tenant` in any migration.
- Every final policy on a tenant table, and every `storage.objects` policy for `payment-proofs`, must contain `current_tenant()` in USING (if it has one) and in WITH CHECK (if the command can write).
- Every final SECURITY DEFINER function whose body names a tenant table must contain `current_tenant()` or `v_tenant`.
- Allow-list `is_admin` and `is_driver`: they compare against `current_tenant()` directly.
- Allow-list the six capability probes.

- [ ] **Step 1: Failing unit tests,** on fixtures written in the test file as SQL strings:
  - a `$$` body containing `;` stays one statement
  - `drop policy x on t` removes `x` from the final state
  - a policy on dotted `storage.objects` is captured
  - a policy without the predicate is reported; adding it clears the report
  - an INSERT policy followed by another policy doesn't swallow it (the bug in `audit-embed-rls.mjs` from inventory §9)
  - the real repo audit returns `problems.length === 0`
- [ ] **Step 2:** Run `npx vitest run src/__tests__/tenantAudit.unit.test.js`. Expected: FAIL (the module is missing).
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS, including the real-repo case. If the real repo reports problems, fix them with a new migration, not by allow-listing.
- [ ] **Step 5:** Commit `test(db): static audit that every tenant policy and RPC filters by tenant`.

### Task 10: Full local rehearsal

**Files:** none (this is verification). A report goes to `docs/superpowers/plans/2026-11-02-phase-2-rehearsal.md`.

- [ ] **Step 1:** Run `supabase db reset --local`, which rebuilds the local database from all migrations, then `npm run test:local -- src/__tests__/` (every suite). Expected: all PASS, with nothing skipped for missing keys.
- [ ] **Step 2:** Old-bundle smoke test. This proves the live 224 site survives the push.
  - Build `master` in a worktree (`git worktree add ../224-master master`), with `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` pointing at the local stack. Pass them as env vars on the command line; never write them to a file.
  - Serve the build with `vite preview`. With a Playwright script in the scratchpad, at 390px wide, do the following:
    - open `/`, `/store`, one product, `/membership` and `/events`
    - sign up a `vitest+` user with a date of birth 30 years ago
    - add a product to the cart and place a cash-on-delivery order
    - open `/orders`
  - Expected:
    - no `pageerror` events
    - the order number matches `/^224-/`
    - the order appears on `/orders`
  - Then remove the worktree.
- [ ] **Step 3:** Write the rehearsal report: suite counts, the old-bundle result, and the migration time on local.
- [ ] **Step 4:** Commit the report.

### Task 11: Production rollout — STOP for the owner's go-ahead

Do not start without an explicit "go" from the owner in chat.

- [ ] **Step 1:** Prerequisites:
  - The owner has added `SUPABASE_SERVICE_ROLE_KEY` to `.env.local`. Check with `npx vitest run src/__tests__/api.contract.test.js`: it must run, not skip.
  - The account gate from CLAUDE.md passes: `gh auth status`, `firebase login:list`, `supabase projects list`.
- [ ] **Step 2:** Backup:
  - Run `supabase db dump --linked -f <outside repo>/pre-phase2-schema.sql`.
  - The owner confirms whether the project has daily backups (Dashboard → Database → Backups). If not, also take a data dump (`--data-only`), stored outside the repo. It contains personal data: delete it after phase 6.
- [ ] **Step 3:** Run `supabase migration list --linked` (shows 7 pending), then `supabase db push`.
- [ ] **Step 4:** Run `npm run predeploy`, now including the tenancy suite and audit, against production. Expected: all PASS, none skipped.
- [ ] **Step 5:** Live smoke: run `node scripts/compare-rendered.mjs` against the stage 1 baseline and 224clubhouse.store (expect 20/20). The owner places one real order on their phone; it must show `224-…`.
- [ ] **Step 6:** Rollback note: migrations are additive, so the live frontend needs no rollback. If an RPC misbehaves, a follow-up migration restores that function's previous body from the inventory file:line. Record the outcome in `OPEN_ITEMS.md` §7a.
