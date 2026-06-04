# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

E-commerce + membership site for **224 Clubhouse** (a South African cannabis lounge in Boksburg). Public storefront (products, events, memberships, cart, Paystack checkout) plus an email-allowlisted admin area. React 19 SPA, no SSR.

## Commands

```bash
npm run dev       # Vite dev server (HMR)
npm run build     # Production build to dist/
npm run preview   # Serve the built bundle
npm run lint      # ESLint over the repo
```

**There is no test runner configured** — no `test` script, no vitest/jest installed. If you add tests, you must also add the tooling and a `test` script. (The global `~/.claude/CLAUDE.md` mandates layered DB/RLS contract tests for any project with a database + auth; this project has both but none of those layers exist yet.)

Verify changes with `npm run lint` and `npm run build` before claiming done.

### Data / ops scripts (run manually with `node`, not part of the app build)

Each script in `scripts/` parses `.env.local` by hand and uses the **service-role key** (`SUPABASE_SERVICE_ROLE_KEY`) — they bypass RLS. They are one-off admin tools, not app code.

```bash
node scripts/setup-buckets.js         # create the three public storage buckets
node scripts/seed.js                  # WIPES then reseeds products + events (destructive)
node scripts/fetch-product-images.js  # pull CC images from Wikimedia, upload, patch product rows
node scripts/upload-images.js         # upload ./224-images-staging/* and regenerate image-manifest.json
```

`scripts/seed.js` deletes all rows in `products` and `events` before inserting — never run it against production data without confirmation.

### Supabase CLI (migrations live in `supabase/migrations/`)

```bash
supabase db push                                  # apply migrations to the linked project
supabase migration new <name>                     # scaffold a new migration
```

## Architecture

### Dual backend — Supabase is primary, Firebase is optional

- **Supabase** (`src/lib/supabase.js`) is the source of truth: Postgres (products, orders, events, memberships, newsletter_subscribers), Auth, and Storage. Uses the **anon key** client-side; RLS enforces access.
- **Firebase Realtime Database** (`src/lib/firebase.js`) is used *only* for live order-status push. It is **guarded**: `db` is `null` unless `VITE_FIREBASE_DATABASE_URL` is set. Every Firebase call must be wrapped in `if (db)` — see `Checkout.jsx`, `useOrders.js`, `useOrderStatus.js`. The app works fully without Firebase configured.

### Auth & admin authorization (security model)

- Login is Supabase email/password (`AuthContext.jsx`).
- **Admin status is a server-side boundary.** `AuthContext` resolves it via the `is_admin()` Postgres RPC, which checks the `admin_users` table under RLS (migration `*_admin_authorization.sql`). The client `isAdmin` only drives UI (showing `/admin/*`); the real enforcement is RLS — write policies on products/events/memberships/newsletter and storage upload/delete all require `is_admin()`. Add/remove admins by editing the `admin_users` table (dashboard or a service-role script); there is no admin env var.
- **`orders` is the exception (still being hardened).** Its RLS is deliberately left as the original `auth.role() = 'authenticated'` because order creation is mid-migration to a server-side, payment-verified flow. Until that lands, `orders` writes are not yet locked down. See `tasks/todo.md` Workstream 2.

### Data layer — TanStack Query hooks in `src/hooks/`

All DB access goes through hooks (`useProducts`, `useOrders`, `useEvents`, `useMemberships`, etc.) that wrap `supabase.from(...)`. The `QueryClient` (in `App.jsx`) defaults to `staleTime: 2min`, `retry: 1`. Mutations invalidate query keys on success. Don't call `supabase` directly from components — add/extend a hook.

### Money is stored as integer cents (ZAR)

`price`, `total`, `ticket_price`, membership `amount`, etc. are **integers in cents**. `12000` = R120.00. Paystack's `amount` field also expects cents. Format for display with `formatZAR` / `src/utils/formatCurrency.js` (divides by 100). Never store or pass rands as decimals.

### Cart

`CartContext.jsx` — `useReducer` persisted to `localStorage` under key `224-cart`. Quantities are clamped to the product's `stock_quantity` in the reducer. `useCart()` exposes `cartCount` / `cartSubtotal` (subtotal in cents).

### Checkout flow (`src/pages/Checkout.jsx`)

Paystack inline popup (`@paystack/inline-js` attaches `window.PaystackPop`; see `PaystackButton.jsx`). On payment success, in order:
1. Insert `orders` row (status `paid`, with Paystack reference).
2. Call `decrement_stock` RPC per item (failures swallowed — RPC is best-effort).
3. Mirror status to Firebase if `db` is configured.
4. Invoke the `send-order-email` Supabase Edge Function.
5. Clear cart, navigate to `/order-confirmation/:id`.

Note: payment is **not verified server-side** — the client trusts the Paystack callback before writing the order.

### Images

Public Supabase Storage buckets: `product-images`, `event-images`, `brand-assets`. `src/hooks/useStorageImages.js` reads the build-time `scripts/image-manifest.json` and a **hardcoded** Supabase project URL (`BASE`). If the Supabase project changes, that `BASE` constant must be updated too.

### Routing & age gate

`react-router-dom` v7 in `App.jsx`. Public routes wrapped in `PublicLayout` (Navbar/Footer); `/admin/*` wrapped in `ProtectedRoute`. `AgeGate` (21+) renders globally and is gated by `localStorage` key `age-verified` (`src/utils/ageGate.js`).

## Styling

Tailwind v3 (config in `tailwind.config.js`). Dark theme with a fixed brand palette — use the named tokens, not hex literals: `background` `#0a0a0a`, `surface` `#111`, `gold` `#C9A84C`, `gold-light`, `muted`, `border`. Fonts: `font-heading` (Playfair Display), `font-body` (Inter). Reusable component classes (`.btn-gold`, `.btn-outline`, `.input-base`, `.card-hover`, `.section-heading`, `.text-gold-gradient`) are defined in `src/index.css` `@layer components` — prefer these over re-rolling styles.

## Environment variables

All client vars are `VITE_`-prefixed (see `.env.example`). `SUPABASE_SERVICE_ROLE_KEY` is **server/script-only** — never import it into `src/`. Live secrets go in `.env.local` (gitignored), which the `scripts/` files read directly.

# EFF Election Monitoring App — Claude Rules

## MANDATORY: Account Check Before Push or Deploy

**Before any `git push`, `supabase db push`, `firebase deploy`, or any deployment action, always verify all three accounts first.** If any are wrong, stop and prompt the user to re-authenticate before proceeding.

```bash
# 1. GitHub — must show tlaphane-1
gh auth status

# 2. Firebase — must show tlaphane@gmail.com
firebase login:list

# 3. Supabase — must show tlaphane's Project (jqxzhgjazvftgobfqjox)
supabase projects list
```

If any account is wrong:
- GitHub: `gh auth switch` or `gh auth login`
- Firebase: `firebase logout` then `firebase login`
- Supabase: `supabase logout` then `supabase login`

Never push or deploy until all three are confirmed correct.

---

## Session Start Checklist

At the start of every session, verify the following accounts are active before doing any git, Supabase, or Firebase operations:

### GitHub
```bash
gh auth status
```
Expected: logged in as **tlaphane-1** (`tlaphane@gmail.com`)
If wrong: `gh auth switch` or `gh auth login` and select the tlaphane-1 account.

### Firebase
```bash
firebase login:list
```
Expected: **tlaphane@gmail.com**
If wrong: `firebase login` (will open browser — user must authenticate as tlaphane@gmail.com).

### Supabase
```bash
supabase projects list
```
Expected: projects owned by **tlaphane@gmail.com**
If wrong: `supabase login` (user must authenticate as tlaphane@gmail.com).

---

## Git Rules

- All `git push` and `git pull` operations must use the **tlaphane-1** GitHub account.
- Local git config must be:
  - `user.name = tlaphane-1`
  - `user.email = tlaphane@gmail.com`
- Always verify with `git remote -v` before pushing.
- Never push with a different account.

---



## UI work — design system is authoritative

Before building or modifying any UI, **read `docs/DESIGN_SYSTEM.md`**. Treat it as authoritative. All colors, spacing, typography, and radii must come from documented tokens. Never hardcode hex values or off-scale sizes.

For any new screen or substantial UI change: **propose layout and visual approach in chat first**, including which tokens you'll use and how the screen handles loading / empty / error states. Wait for approval before writing components.

Before declaring UI work done: invoke the `ui-reviewer` subagent. Address all CRITICAL issues. WARNING issues require justification to skip.