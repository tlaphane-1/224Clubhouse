# Phase 2 rollback runbook (multi-tenant database)

For the production push in Task 11 of `2026-11-02-multi-tenant-phase-2-database.md`.
Phase 2 is additive: the live frontend needs no rollback. These levers undo the
database behaviour only, smallest first. Every lever is safe **only while 224 is
the only store** (the old bodies are not tenant-scoped).

Run the SQL in the Supabase Dashboard SQL editor for project `aogdkqczvlffgydgxsmz`
(fastest), then add the same SQL as a follow-up migration file so the repo matches
the database. Never use `supabase db reset --linked`.

## 1. Signups fail: drop the tenant stamp trigger (fastest lever)

```sql
drop trigger if exists on_auth_user_tenant on auth.users;
```

New accounts then get no `app_metadata.tenant`, and `current_tenant()` falls back
to `default_tenant()` = `224clubhouse`, exactly like a pre-backfill session.
Existing claims stay. Nothing else depends on the trigger.

## 2. An RPC misbehaves: restore its pre-phase-2 body

The pre-phase-2 body of every function is at the file:line in the "final def"
column of `2026-11-02-phase-2-schema-inventory.md` §3, at commit `0e6b396`
(master before phase 2). Extract it, check it starts with `create or replace
function` and ends with `$$;`, then run it. `create or replace` keeps the
signature, owner and grants.

```bash
# place_cod_order: inventory 1008a:127 -> 20261008120000_age_verification.sql lines 127-369
git show 0e6b396:supabase/migrations/20261008120000_age_verification.sql | sed -n '127,369p' > restore.sql
# is_admin: inventory 0604:43 -> 20260604120000_admin_authorization.sql lines 43-51
git show 0e6b396:supabase/migrations/20260604120000_admin_authorization.sql | sed -n '43,51p' >> restore.sql
```

For any other function, find its end line with
`git show 0e6b396:supabase/migrations/<file> | grep -n '^\$\$;'`. Alternative
source: the `create or replace function` block in the Task 11 pre-push schema
dump (`pre-phase2-schema.sql`).

## 3. Policies misbehave: restore from the pre-push dump

Take the table's `CREATE POLICY` statements from `pre-phase2-schema.sql` (Task 11
Step 2). For each one: `drop policy if exists <name> on <table>;` then the old
`create policy`. If `is_admin()` / `is_driver()` are involved, restore them first
(lever 2; `is_driver` is inventory 1007d:36). The old policies do not mention
`tenant`, so they work with the new columns in place.

## 4. What can stay

Leave these in place; the old bodies and policies ignore them:

- the `tenant` columns (default `current_tenant()` = `224clubhouse` for every
  existing caller, so old inserts that do not name `tenant` still get 224),
  their indexes and the tenant-scoped uniques (equivalent to the old global
  ones while there is one store);
- `alert_settings` keyed by tenant (224's row keeps `id = 1`);
- the backfilled `app_metadata.tenant` claims and the `tenants` table;
- the helpers `current_tenant()`, `default_tenant()`, `tenant_min_age()`,
  `tenant_order_prefix()`, `tenancy_applied()`, `telegram_secret_name()`.

Do not restore `decrement_stock`: it was dropped as a security fix.

## 5. Who decides, and how to verify

The owner (tlaphane) decides whether to roll back; Claude proposes the lever.
After any lever:

1. `npm run predeploy`: every pre-phase-2 suite must pass. The tenancy suite
   then fails on the rolled-back parts (expected, see the rehearsal below).
2. `node scripts/compare-rendered.mjs` against the stage 1 baseline and
   224clubhouse.store: expect 20/20.
3. The owner places one real order on their phone: it must show `224-…`. If
   lever 1 was used, also do one test signup.
4. Record what was rolled back, and why, in `OPEN_ITEMS.md` §7b.

While any lever is in place, `predeploy` fails (the tenancy suite runs inside it),
so it blocks frontend hotfixes too. Until the suite is reconciled with the rolled-back
schema, deploy a hotfix with `npm run build` and `firebase deploy` after running the
pre-phase-2 suites by hand.

## Rehearsal (local stack, 2026-11-03)

Applied levers 1 and 2 (`place_cod_order` and `is_admin`, extracted with the
exact commands above) to the local stack with every phase-2 migration in place.
The old bodies installed cleanly: grants unchanged (`place_cod_order` executable
by `authenticated` only, `is_admin` as before), no `v_tenant` / `current_tenant`
left in either body, trigger gone.

`npm run test:local -- src/__tests__/*.contract.test.js src/__tests__/rlsEmbedAudit.test.js`:
**19 of 20 files passed**: every pre-phase-2 suite is green on the old bodies
(201 passed, 14 failed, 43 skipped in total). All 14 failures were in
`tenancy.contract.test.js`, as expected:

- 1 `is_admin` isolation test (an admin row in another store is admin again);
- 6 order-RPC isolation tests (no `VTB-` prefix, no cross-store product refusal,
  no per-store age, no "Unknown store");
- 7 signup-stamp tests (no claim stamped without the trigger).

The 224-only tenancy tests, including the claimless old-session checkout
(`224-…`), still passed. Restored with `supabase db reset --local` plus a restart
of `supabase_kong_224clubhouse`; the phase-2 bodies and trigger were back.
