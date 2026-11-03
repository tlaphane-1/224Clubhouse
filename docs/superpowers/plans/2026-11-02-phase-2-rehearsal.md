# Phase 2 local rehearsal (2026-11-02)

Branch `feature/multi-tenant-db` at `ebb785d`. Local Supabase stack only; nothing touched the linked project.

## 1. Rebuild from scratch and full suite

- `supabase db reset --local` applied all 37 migrations with no errors. Wall time 31-32 s for the whole reset (includes the container restart).
- `npm run test:local -- src/__tests__/` (every file, unit + contract + tenancy): **32 files, 342 passed, 0 failed, 43 skipped**.
- Every skip is an inverse placeholder block (the "SETUP BROKEN" / "skipped (...)" describes that only run when setup is missing). No real test was skipped for missing keys; every real describe ran.

| Group | Files | Passed |
|---|---|---|
| Existing contract suites (unchanged) | 19 | 140 |
| `tenancy.contract.test.js` | 1 | 79 |
| Unit and audit (`tenantAudit`, `loadTenant`, `migrationGate`, `rlsEmbedAudit`, brand/browser imports, theme, tenant, cart, index.html, map, whatsapp) | 12 | 123 |

Per-file passes: adminDailySummary 2, ageVerification 5, api.anonContract 6, api.contract 10, cod 7, deliveryEta 5, deliveryFeedback 6, discountCodes 13, driverPortal 10, eftVerification 11, eventReservations 10, membership 17, newsletter 7, ordersByEmailRetired 1, ownerAlerts 3, restock 5, siteAnalytics 4, storeUpgrades 14, telegramAlerts 4, tenancy 79, tenantAudit 35, loadTenant 33, migrationGate 19, tenant 10, indexHtml 8, whatsappOrder 6, mapEmbed 3, cartClear 3, brandLiterals 2, browserImports 2, rlsEmbedAudit 1, theme 1.

## 2. Old bundle (master, the live site) against the new database

- `master` (`0e6b396`) built in a throwaway worktree with `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` pointing at the local stack (command-line env only), served with `vite preview`, driven by Playwright (Chromium, 390x844).
- Seeded with a service-role script: one product (stock 25), one event. The 3 membership tiers come from the migrations.
- Flow, all passed:
  - Age gate passed by clicking "Yes, I'm 21+".
  - `/`, `/store`, `/store/<product>`, `/membership` (tiers render), `/events` (seeded event renders).
  - Signed up a `vitest+smoke-...@example.com` user with a DOB 30 years ago (no email confirmation locally).
  - Added the product to the cart and placed a cash-on-delivery order via `place_cod_order`: order number `224-485145` (matches `/^224-/`).
  - `/orders` listed that order.
- `pageerror` events: **0**. Failed or 4xx/5xx calls to the local API: the two items below, neither a database regression.
- The flow ran three times (the first only to find the noise below); all three passed. The order number above is from the last run.

### Noise seen, not regressions
- `POST /functions/v1/send-order-email` returned 500 with Resend "API key is invalid". The local edge runtime has no `RESEND_API_KEY`, the same known blocker as in production. The function got as far as calling Resend, so it read the order under the new tenant-aware policies. The bundle fires it and ignores the result.
- Brand images (`brand-assets/...`) failed with `ERR_BLOCKED_BY_ORB` / 400: the local storage buckets are empty after a reset. Cosmetic (broken logo icons in screenshots).

## 3. Workarounds used
- `supabase.exe` on PATH is a broken shim; used `supabase.exe.old-2.98.2` for reset and for `test:local`.
- After `db reset`, Kong kept a stale upstream IP for the restarted auth container (`/auth/v1/*` returned 502, which made every auth-using suite fail in the first attempt: 16 failed files, 7 failed tests, 176 passed, all with an empty setup error). Restarting only the local `supabase_kong_224clubhouse` container fixed it. The reset was then repeated from scratch and the suite re-run clean; the numbers above are from that run. Anyone repeating this: after `db reset --local`, wait for or restart Kong before running tests.
- The Playwright context used `ignoreHTTPSErrors: true`; Chromium did not need `--ignore-certificate-errors` for the API calls (the page's fetches to `https://127.0.0.1:56321` worked).
- `scripts/seed.js` was not used. Seed and cleanup used a scratchpad service-role script; the smoke users, orders, product and event were deleted afterwards (local tables are empty again).
- The prerender step of the master build warned it could not fetch products/events (self-signed cert in Node); it only affects static SEO pages, not the SPA.
- The master worktree was removed with `git worktree remove --force`.

## Issues
None against the migrations or the old bundle.
