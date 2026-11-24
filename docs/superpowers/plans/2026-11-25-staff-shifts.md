# Staff Accounts + Selfie Shift Clock-in Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Part 1 of the E420 in-store system — a staff role managed in Admin → Staff, and a `/counter` screen where staff start/end a shift with a timestamped selfie that admins review in Admin → Shifts.

**Architecture:** New `staff_members` and `shifts` tables (tenant-scoped, RLS like `drivers`), an `is_staff()` helper, and SECURITY DEFINER RPCs for every write (server clock, one open shift per person). Selfies go to a private `shift-selfies` bucket under `<tenant>/<uid>/`. UI is gated by a per-store `features.inStore` flag in `tenant.json` (E420 on, 224 off).

**Tech Stack:** React 19, TanStack Query hooks, Supabase (Postgres RPC + RLS + Storage), vitest (unit + live contract). Camera via `<input type="file" accept="image/*" capture="user">` — no new library in this part.

**Spec:** `docs/superpowers/specs/2026-11-24-e420-in-store-design.md` (Part 2 "Shift clock-in" + "Who can do what").

## Global Constraints

- Branch `feat/e420-in-store` from `feat/e420-collect-only` (E420 collect-only lands first); never commit to `master`.
- Every table has `tenant text not null default public.current_tenant() references tenants(slug)`; every policy and RPC filters `tenant = current_tenant()`.
- Shift times come from the server (`now()`), never the device.
- Selfies: private bucket `shift-selfies`, max 3 MB, `image/jpeg|png|webp|heic|heif`; path `<tenant>/<uid>/<epoch-ms>.<ext>`; readable by the owner and admins of that store only.
- The shared tablet signs in as **staff**, never admin. `is_staff()` is true for active staff **and** for admins of the store.
- `features.inStore`: `true` for explosive420, `false` for 224clubhouse. Off ⇒ no `/counter`, no Staff/Shifts admin nav.
- UI: `docs/DESIGN_SYSTEM.md` tokens and existing classes; 44 px taps; works on phone and tablet.
- Verify with `npm run lint`, `npm test`, and the new contract suite on the local stack (`npm run test:local -- src/__tests__/staffShifts.contract.test.js`); add the suite to `test:contract` and `predeploy`.

## Review Focus

1. **A customer (not staff) calls `start_shift`** or uploads into `shift-selfies` → refused. → Task 1 test.
2. **Staff taps Start twice** (double tap / two tabs) → second call refused, one open shift. → Task 1 test.
3. **Staff uploads a selfie into another person's or another store's folder** → storage refuses. → Task 1 test.
4. **A vitest-b staff member against 224** (`x-tenant` / claim) → not staff there, sees no 224 shifts. → Task 1 test.
5. **Ending a shift with none open** → clear error, nothing changed. → Task 1 test.

---

### Task 1: Database — staff, shifts, selfie bucket, RPCs

**Files:**
- Create: `supabase/migrations/20261125100000_staff_shifts.sql`
- Create: `src/__tests__/staffShifts.contract.test.js`
- Modify: `package.json` (append the suite to `test:contract` and `predeploy`)

**Interfaces — Produces:**
- `staff_members(user_id uuid pk → auth.users on delete cascade, tenant, full_name text 1–80, active bool default true, created_at)`; RLS: admin all (same tenant), self select.
- `shifts(id uuid pk default gen_random_uuid(), tenant, user_id uuid → auth.users, started_at timestamptz not null default now(), ended_at timestamptz, selfie_path text not null, created_at)`; partial unique index `(user_id, tenant) where ended_at is null`; RLS: select own or admin (same tenant); no insert/update/delete policies.
- `public.is_staff() returns boolean` (security definer, stable): active `staff_members` row in current tenant, or `is_admin()`. Grant anon, authenticated.
- `public.admin_add_staff(p_email text, p_full_name text) returns uuid` — admin only; finds `auth.users` by lower(email) whose `raw_app_meta_data->>'tenant'` (or `raw_user_meta_data->>'tenant'`) equals current tenant; upserts `staff_members` (re-activates); errors: `'Not authorized'`, `'No account with that email in this store — ask them to sign up first'`.
- `public.admin_set_staff_active(p_user_id uuid, p_active boolean) returns void` — admin only, same tenant.
- `public.start_shift(p_selfie_path text) returns jsonb {id, started_at}` — requires `is_staff()` (`'Not authorized'`); path must match `^<current_tenant>/<auth.uid()>/[^/]+$` (`'Invalid selfie path'`); open shift exists ⇒ `'Shift already started'`.
- `public.end_shift() returns jsonb {id, started_at, ended_at}` — own open shift in tenant, else `'No open shift'`.
- `public.my_open_shift() returns jsonb | null`.
- Storage: bucket `shift-selfies` (private, 3145728 bytes, mime list above); policies: insert when `is_staff()` and folder[1] = current_tenant() and folder[2] = auth.uid(); select own folder or `is_admin()` with folder[1] = current_tenant(); delete `is_admin()` same tenant.
- RPC grants: `admin_*`, `start_shift`, `end_shift`, `my_open_shift` to authenticated only.

- [ ] **Step 1: Write the contract test** (pattern: `collectFulfilment.contract.test.js`; gate on `staff_members`; tenant `vitest-b` via `ensureTestTenant`; admin = `createTenantUser` + service-role insert into `admin_users` with tenant `vitest-b`; clients via `signInClient(email, TEST_PASSWORD, { tenant })`). Cases:
  - `admin adds a staff member by email; is_staff() becomes true for them`
  - `admin_add_staff refuses an email with no account in this store` (error matches `/No account with that email/`)
  - `a customer is not staff: start_shift → /Not authorized/; upload to shift-selfies refused`
  - `staff uploads a selfie to <tenant>/<uid>/… and starts a shift; started_at is server time (within 60 s of now)`
  - `a second start_shift while open → /Shift already started/`
  - `start_shift with another user's folder → /Invalid selfie path/`; `upload into another uid's folder refused`
  - `end_shift closes it; a second end_shift → /No open shift/`
  - `staff sees only their own shifts; the store admin sees all of the store's shifts and can create a signed URL for the selfie; another customer cannot`
  - `deactivated staff → is_staff() false, start_shift refused`
  - `NEGATIVE: vitest-b staff is not staff for 224 (no-header client after sign-in with 224 claim) and sees no vitest-b shifts there`
  - cleanup in `afterAll`: shifts, staff rows, admin_users row, storage objects, users.
- [ ] **Step 2: Run** `npm run test:local -- src/__tests__/staffShifts.contract.test.js` — expect SKIP (gate), then apply an empty migration file and expect FAIL.
- [ ] **Step 3: Write the migration** per Interfaces. Apply to the local DB (`docker exec -i supabase_db_224clubhouse psql … < file`, record the version, `notify pgrst, 'reload schema'`).
- [ ] **Step 4: Run** the suite — PASS; also `tenancy`, `driverPortal`, `api.anonContract` suites — unchanged PASS. Add a line to `rlsEmbedAudit` exemptions only if the audit flags the new tables.
- [ ] **Step 5: Commit** `feat(db): staff members, shifts and private selfie bucket`

### Task 2: Store flag, auth role, hooks, pure helpers

**Files:**
- Modify: `tenants/224clubhouse/tenant.json` (`"features": { "inStore": false }`), `tenants/explosive420/tenant.json` (`"features": { "inStore": true }`), `src/tenant.js`, `src/context/AuthContext.jsx`
- Create: `src/hooks/useStaff.js`, `src/hooks/useShifts.js`, `src/utils/shifts.js`
- Test: `src/utils/shifts.test.js`, extend `src/__tests__/tenant.unit.test.js`, `src/__tests__/loadTenant.unit.test.js`

**Interfaces — Produces:**
- `IN_STORE: boolean` from `src/tenant.js` (`tenant.features.inStore === true`).
- `useAuth()` gains `isStaff: boolean` (resolved like `isDriver`, via `rpc('is_staff')`, time-boxed in `signIn`).
- `selfiePath(tenantSlug: string, userId: string, nowMs: number, mime: string) -> string` → `'<tenant>/<uid>/<nowMs>.<ext>'` (`image/png`→png, `image/webp`→webp, `image/heic`/`heif`→heic, else jpg).
- `shiftDuration(startedAt: string, endedAt: string | null, nowMs: number) -> string` → `'7h 05m'`, `'0h 45m'`.
- `dayBoundsSast(dateIso: 'YYYY-MM-DD') -> { from: string, to: string }` — ISO instants for 00:00 to 24:00 Africa/Johannesburg (UTC+2, no DST).
- Hooks: `useStaffMembers()`, `useAddStaff()` (`{email, fullName}`), `useSetStaffActive()`; `useMyOpenShift()`, `useStartShift()` (takes a `File`: uploads then `start_shift`), `useEndShift()`, `useShiftsForDay(dateIso)` (rows + `staff_members(full_name)` via a second query, not an embed), `useSelfieUrl(path)` (signed URL, 10 min).

- [ ] **Step 1: Failing tests:** `selfiePath('explosive420','u1',1700000000000,'image/png') === 'explosive420/u1/1700000000000.png'`; `'image/heic'` → `.heic`; unknown → `.jpg`. `shiftDuration('2026-11-25T07:00:00Z','2026-11-25T14:05:00Z') === '7h 05m'`; open shift uses `nowMs`. `dayBoundsSast('2026-11-25')` → `{ from: '2026-11-24T22:00:00.000Z', to: '2026-11-25T22:00:00.000Z' }`. `IN_STORE === false` for the default (224) tenant; `loadTenant('explosive420').features.inStore === true`; `validateTenant` rejects a non-boolean `features.inStore`.
- [ ] **Step 2: Run** `npx vitest run src/utils/shifts.test.js src/__tests__/tenant.unit.test.js src/__tests__/loadTenant.unit.test.js` — FAIL.
- [ ] **Step 3: Implement** helpers, flag (+ boolean check in `validateTenant`), `isStaff` in AuthContext (mirror `resolveDriver`), hooks (mutations invalidate `['shifts']`, `['my-open-shift']`, `['staff']`). Regenerate function stores if `tenant.json` shape changed (`node scripts/build-function-stores.mjs`).
- [ ] **Step 4: Run** tests + `npm run lint` — PASS.
- [ ] **Step 5: Commit** `feat(in-store): store flag, staff role in auth, shift hooks`

### Task 3: `/counter` — shift panel

**Files:**
- Create: `src/pages/counter/Counter.jsx`, `src/components/counter/ShiftPanel.jsx`, `src/components/counter/StaffRoute.jsx`
- Modify: `src/App.jsx` (route `/counter` only when `IN_STORE`, wrapped in `StaffRoute`: loading spinner → signed out shows `CustomerAuth` titled "Staff sign in" → signed in but `!isStaff` shows "This account isn't set up as staff. Ask the owner to add you in Admin → Staff.")
- Modify: `src/components/layout/Navbar.jsx` (signed-in staff get a "Counter" menu link when `IN_STORE`)

Layout (phone/tablet, `bg-background`, one column, max-w-lg centred):

```
COUNTER                         [name] · Sign out
┌ Shift ───────────────────────────────┐  bg-surface border-border rounded-2xl p-6
│ Not on shift                          │
│ [ 📷 Start shift — take a selfie ]    │  .btn-gold, full width, min-h-11
└───────────────────────────────────────┘
(after selfie chosen: preview image, [Confirm & start] .btn-gold, [Retake] .btn-outline)
(on shift: "On shift since 09:02 · 2h 14m", selfie thumbnail, [End shift] .btn-outline)
Sales and stock arrive in Part 2.
```
States: loading (spinner), upload/RPC error (toast + inline `text-red-400` message, selfie kept for retry), "Shift already started" (refetch and show the open shift).

- [ ] **Step 1: Failing test:** `src/utils/shifts.test.js` gains `shiftStatusLabel(openShift, nowMs)` → `'Not on shift'` for null; `'On shift since 09:02 · 2h 14m'` for `{started_at:'2026-11-25T07:02:00Z'}` at `2026-11-25T09:16:00Z` (time shown in SAST).
- [ ] **Step 2: Run** it — FAIL.
- [ ] **Step 3: Implement** `shiftStatusLabel` and the components; `<input type="file" accept="image/*" capture="user">` hidden behind the Start button; preview via `URL.createObjectURL` (revoked on unmount/change).
- [ ] **Step 4: Run** tests + lint + `npm run build:e420`; local demo (`npm run demo:e420`) with a staff row for the demo account: start/end a shift end to end.
- [ ] **Step 5: Commit** `feat(counter): staff shift clock-in with selfie`

### Task 4: Admin → Staff and Admin → Shifts

**Files:**
- Create: `src/pages/admin/Staff.jsx`, `src/pages/admin/Shifts.jsx`
- Modify: `src/App.jsx` (both routes in `ProtectedRoute`, only when `IN_STORE`), `src/components/admin/AdminLayout.jsx` (nav items "Staff" (icon `UserCheck`) and "Shifts" (icon `Clock`), only when `IN_STORE`)

Staff page: add form (email, full name → `useAddStaff`, error text from the RPC shown inline), list (name, active toggle via `useSetStaffActive`), empty state "No staff yet — add the cashier's account email.". Shifts page: date picker (default today SAST), list rows: selfie thumbnail (64 px, opens full size), name, start–end times (SAST), duration (`shiftDuration`), "Still on shift" badge for open shifts; empty state "No shifts on this day."; loading and error states.

- [ ] **Step 1: Failing test:** `src/utils/shifts.test.js` gains `formatSastTime('2026-11-25T07:02:00Z') === '09:02'` and `sortShifts(rows)` (open shifts first, then newest start first).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** helpers and both pages; `brandLiterals`/`browserImports` tests stay green.
- [ ] **Step 4: Run** tests + lint + both builds; local demo: add the demo account as staff, start/end a shift on `/counter`, see it with selfie in Admin → Shifts.
- [ ] **Step 5: Commit** `feat(admin): staff management and shift review`

### Task 5: Verify, review, docs

- [ ] **Step 1:** `npm run lint && npm run build && npm run build:e420` — exit 0.
- [ ] **Step 2:** `npm run test:local` — all pass.
- [ ] **Step 3:** Fresh whole-branch reviewer (UI checked against `docs/DESIGN_SYSTEM.md`, no ui-reviewer agent exists).
- [ ] **Step 4:** `OPEN_ITEMS.md` §7f (Part 1 built, not deployed; rollout: migration, then E420 build; add staff in Admin → Staff; **selfie 90-day deletion not automated yet** — listed as open); `PrivacyPolicy.jsx` gains a staff-selfie line only if staff data is covered there (otherwise note for the owner: staff need their own notice).
- [ ] **Step 5: Commit** `docs: staff shifts rollout`; push and open a PR after the account checks.
