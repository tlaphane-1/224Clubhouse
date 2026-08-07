# 224 Clubhouse — Open Items

> Consolidated status as of **2026-08-07**. Every claim here was verified against the repo or the
> live Supabase project on that date, not carried over from older notes.
>
> `tasks/todo.md` remains the detailed engineering backlog (Paystack workstream, admin polish).
> This file is the shorter "what is actually open and why it matters" list. Where the two disagree,
> trust this file — several `todo.md` entries have since been fixed (see §5).

---

## 1. Blocked on the owner — nothing ships without these

### 1.1 `RESEND_API_KEY` + verified sending domain ⚠️ highest impact
Order receipt emails are **built, deployed and called** but send nothing.

- `supabase/functions/send-order-email` is deployed and ACTIVE on project `aogdkqczvlffgydgxsmz`.
- `Checkout.jsx` invokes it fire-and-forget after `place_cod_order` succeeds.
- It returns **500** because `RESEND_API_KEY` is not set. The client swallows the error by design,
  so there is **no customer-visible failure — and no emails**.

To finish:
```bash
supabase secrets set RESEND_API_KEY=<key>
```
plus verify **orders@224clubhouse.co.za** as a sending domain in Resend. Then place a real test
order — Resend rejects unverified domains and that failure is invisible from the app.

Why it matters beyond convenience: customers currently have no record of their order number, which
is the whole reason the email-only order lookup exists (§2.1).

### 1.2 Paystack keys
Online checkout is disabled; the app is cash/card **on delivery**. `PaystackButton.jsx` is retained
for re-enable. The full server-side verification workstream is specified in `tasks/todo.md`
(Workstream 2) — do not re-enable client-trusted totals; that plan recomputes totals from DB prices.

### 1.3 Product decision: `is_member_only`
Members-only products can be bought by anyone and "member pricing" does not exist. Either enforce it
or remove the badge and claims until a member system exists. Currently the UI makes a promise the
backend does not keep.

### 1.4 Product decision: `WELCOME10`
Promised in the welcome email, honoured nowhere. Implement the coupon or drop the promise.

---

## 2. Decisions waiting

### 2.1 Retire the email-only order lookup?
`get_orders_by_email` lets anyone list the orders for any email address they can guess. This was
**accepted knowingly** on 2026-08-06 to fix customers being unable to find their own orders — the
rationale is in the migration header `20260806120000_orders_by_email.sql`. It is narrowed to summary
fields only (no name, phone, address or line items) and capped at 20.

Once receipts are landing (§1.1), customers have their order number and this can be removed. Until
then it is the only cross-device way to find an order. **Do not "fix" it as an oversight.**

### 2.2 `master` is 14 commits behind the deployed branch
Production is deployed from `feature/memberships-and-pages`. `master` still sits at "Add initial
schema migration". Nothing is broken, but the default branch is not the truth, which will mislead
anyone who clones the repo. Decide whether to merge or rename.

---

## 3. Live defects

### 3.1 The newsletter welcome email silently fails
`src/pages/Home.jsx:54` invokes `send-welcome-email`. The function was deployed on 2026-08-07 and is
ACTIVE, but like `send-order-email` it sends nothing until `RESEND_API_KEY` and domain verification
land (§1.1). Until then subscribers still get a success toast and no email.

### 3.2 No React error boundary
A single render error white-screens the whole app.

### 3.3 Hook error states are invisible
Failed loads look identical to empty results across the storefront.

### 3.4 Oversell is possible
Stock is not checked atomically at payment time. Two simultaneous orders can both pass the check.
`tasks/todo.md` specifies the RPC fix.

---

## 4. Compliance and risk

### 4.1 POPIA
No published Privacy Policy, Terms, or Returns/Delivery page. The terms link at
`Checkout.jsx:164` is dead. This matters more than usual here: the business stores **SA ID numbers**,
and age consent is only a localStorage boolean.

### 4.2 Bundle size
~852 kB storefront bundle; admin and Firebase are not code-split out of it.

---

## 5. Stale claims to correct in existing docs

Verified wrong on 2026-08-07:

- **`CLAUDE.md:53`** says `orders` RLS is "deliberately left as `auth.role() = 'authenticated'`".
  It is not — `20260623120000_security_hardening.sql` dropped that policy and replaced it with
  admin-only select/update/delete. Anonymous order *creation* goes through SECURITY DEFINER RPCs.
- **`tasks/todo.md:66`** says the contact form calls a non-existent `send-contact-email` and fakes
  success. It no longer does — `Contact.jsx:68` inserts into a `contact_messages` table.

---

## 6. Notes for whoever picks this up

- **Edge Function deploys need `--use-api`.** `supabase functions deploy` bundles with Docker, and
  Docker Desktop does not start on this machine. `supabase functions deploy <name> --use-api`
  bundles server-side and works.
- **Contract tests are dormant.** Layers 1/2 skip without `SUPABASE_SERVICE_ROLE_KEY` in
  `.env.local`, so a green run proves less than it appears to. Set the key and run
  `npm run test:contract` for real coverage.
- **Pre-existing noise, not caused by recent work:** 10 lint errors (`npm run lint`), and 3 Playwright
  specs under `e2e/` that fail when `vitest` picks them up. Both predate 2026-08-06.
- **Account gates before any deploy** (see `CLAUDE.md`): `gh auth status` must be `tlaphane-1`,
  `firebase login:list` must be `tlaphane@gmail.com`, and the Supabase project ref is
  `aogdkqczvlffgydgxsmz`.

---

## 7. Recently completed (2026-08-06 → 07) — do not redo

- Customers can find orders three ways: remembered per-device (`src/utils/recentOrders.js`), by
  email alone (`get_orders_by_email`), or by order number. The confirmation page recovers the order
  number after a refresh instead of stranding the customer.
- `send-order-email` rewritten for cash/card-on-delivery. It previously took a `paystack_reference`
  and displayed status **"Paid"** / **"Total Paid"** — under the current model that would tell
  customers they had already paid, inviting a dispute at the door. It now leads with the order
  number, says "Amount due on delivery", and links to `/track?order=NNN`.
