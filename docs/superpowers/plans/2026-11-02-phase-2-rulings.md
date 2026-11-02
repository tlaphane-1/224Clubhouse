# Phase 2: decisions made during the build, and what's still open

These are the calls Claude made on the owner's behalf while building phase 2 (Tasks 1–10, plus the final fix wave). Each one says what it costs if it turns out to be wrong. Production was not touched.

## Rulings

1. **Task 5's "old session" test clears the tenant claim before it signs in**, so it still tests a JWT with no claim after the signup stamp exists. If wrong, one test line changes.
2. **`profile_from_signup` holds its tenant in `v_tenant`**, which is the name the static audit recognises. If wrong, one rename.
3. **(Superseded by 5.)** Loosen the eft `https` assertion.
4. **The local stack runs on ports 563xx**, because other projects' local stacks hold the defaults. If wrong, edit the ports in `config.toml`.
5. **The eft assertion was reverted, and the local stack serves https** (self-signed certificate). `NODE_TLS_REJECT_UNAUTHORIZED=0` is set only in the local test child process. If wrong, the local run is noisier.
6. **The 563xx ports stay**, with a comment explaining why. If wrong, edit the ports.
7. **Subagent commits carry their own accurate Co-Authored-By model line.** If wrong, only the trailer wording is affected.
8. **An unknown store slug fails closed.** A NULL `tenant_min_age()` or `tenant_order_prefix()` raises an error and never skips the age check. If wrong, one extra guard line.
9. **`current_tenant()` deviates from spec §5.1** (recorded in §11). A signed-in user's store comes only from their JWT claim. Without a claim it is 224, never the `x-tenant` header. If wrong, a claim-less signed-in user of a new store would resolve to 224. That can't happen once signups are stamped.
10. **`createTenantUser` puts the test user's profile in that user's own store.** If wrong, the test helper needs rework.
11. **`admin_becomes_driver` stamps the driver row from the admin's store** (`NEW.tenant`). If wrong, admin-driver rows land in the wrong store.
12. **Parked: admins of either store can delete or overwrite product and event images across stores.** The paths aren't store-prefixed, which is phase 4 work. **This must be fixed before any second store has an admin.** If it isn't, a store admin could wipe another store's images.
13. **The order-path age message stays as today's exact text.** It names no age. If wrong, Explosive 420 customers see a message without "18".
14. **Parked: a child row can point at another store's parent row.** For example, a store-B variant on a 224 product. Fix it with composite FKs or check triggers before phase 5. If it isn't fixed, stray cross-store child rows appear; they are harmless to 224.
15. **The signup stamp reads the tenant from `user_metadata`**, because GoTrue's admin `createUser` sets `app_metadata` only after the insert. There is no UPDATE trigger, so a store can't be changed later. If wrong, admin-created store-B users get a 224 profile.
16. **Parked: `telegram-connect` calls the database with no `x-tenant`.** A store-B admin connecting Telegram would overwrite 224's token and chat. **Phase 3 must fix this before any second store has an admin.**
17. **The tenancy suite is new on this branch, so its own setup may be edited.** No cost if wrong.
18. **The `READ_ONLY_RPCS` list in `liveFixtures.js` gained the new read-only helpers.** It changes retry behaviour only. If wrong, revert the list entries.
19. **Runtime per-table isolation tests (spec §5.11) are deferred to phase 4/5 planning.** The static audit guarantees every predicate is present. If wrong, a predicate bug is found later rather than now.
20. **Parked: the `lock_timeout` evidence is ambiguous.** The CLI's own 4-second lock timeout may explain the local failure. Fail-fast holds either way, at 4 s or 5 s. Optional before Task 11: a decisive 15-second re-test, described in the final re-review. If wrong, the migration comments overclaim "rehearsed".
21. **Parked: the alert no-leak read check is weak locally** (224's local row is all defaults, and `kinds` is matched as a subset). The `telegram_config` and update before/after checks still tell leak from no leak. If wrong, the local signal is weaker.
22. **Before Task 11, add one line to the rollback runbook**: after a DB rollback, `predeploy` blocks frontend hotfixes until the tenancy suite is reconciled. If this is skipped, a deploy gets blocked confusingly during an incident.

## Before Task 11 (production)

- The owner adds `SUPABASE_SERVICE_ROLE_KEY` to `.env.local`.
- The owner confirms whether daily backups are on.
- Use the working CLI binary at `C:/Users/azgcl/bin/supabase.exe.old-2.98.2`. The `supabase.exe` shim on PATH is broken.
- Read-only checks: production row counts (plan Task 11 Step 2), plus any Dashboard-created triggers or webhooks on `orders` and `memberships`. The tenancy suite's test orders would fire them.
- Rulings 20 and 22 above.

## Before a second store gets an admin (phases 3–5)

- Rulings 12, 14 and 16.
- Any service-role `createUser` that passes `app_metadata` must include `tenant`.
- Runtime isolation tests for every tenant table, including the `with check` move-a-row cases and the reverse direction of the forged-tenant insert (Ruling 19).
- Decide whether `tenants.active` gates signups and the `x-tenant` header.
- Wire the cart-reminder and daily-summary Edge Functions to send `x-tenant`.

The rollback runbook is `2026-11-02-phase-2-rollback.md`; the rehearsal evidence is `2026-11-02-phase-2-rehearsal.md`.
