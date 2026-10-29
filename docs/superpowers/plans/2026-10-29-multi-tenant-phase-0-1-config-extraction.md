# Multi-tenant Phase 0–1: Hygiene + Frontend Config Extraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every 224 Clubhouse–specific fact in the website (not the database) into `tenants/224clubhouse/`, selected at build time by `TENANT`, so the 224 build is visibly identical to today and a second store can later be built from the same code.

**Architecture:** A per-store folder `tenants/<slug>/` holds `tenant.json` and that store's `public/` assets. `tenants/loadTenant.mjs` (Node) resolves `TENANT` (default `224clubhouse`), loads and validates the file; `vite.config.js` aliases `@tenant` to that folder, points `publicDir` at its `public/`, and a small Vite plugin fills `index.html`. `src/tenant.js` is the only module in `src/` that reads the config; everything else imports from it. Node scripts (`tailwind.config.js`, `prerender-seo.mjs`, `build-driver-icons.mjs`) call `loadTenant()` directly.

**Tech Stack:** React 19, Vite 8, Tailwind 3, Vitest 4, Playwright (already installed, used for the render comparison script). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-24-multi-tenant-design.md` — this plan implements §6 (hygiene, partly) and §7 phases 0–1. Later phases get their own plans.

## Global Constraints

- Default slug is `224clubhouse`. With `TENANT` unset, `npm run dev`, `npm run build`, `npm test`, `npm run lint` behave as today.
- **No changes** to `supabase/` (migrations, functions, templates), Supabase dashboard settings, `firebase.json`, `.firebaserc`, or `dist` output location in this plan.
- 224's rendered output stays identical: page titles, all copy, links, phone/email/address, image URLs, order/payment reference format (`224-…`), and every browser storage key (`224-cart`, `age-verified`, `224-vid`, `224-sid`, `224-src`, `224:recent-orders`, `224-driver-install-dismissed`).
- Tailwind token names do not change (`background`, `surface`, `gold`, `gold-light`, `muted`, `border`, `leaf`, `leaf-deep`, `paper`, `paper-line`, `print`, `ink`); only where their values come from.
- Copy moved into `tenant.json` is copied **verbatim** from the current source, character for character.
- No hex literals in `src/` (`docs/DESIGN_SYSTEM.md`).
- No new npm dependencies.
- Do not read `.env.local` or any `.env*` except `.env.example`.
- Work on branch `feature/multi-tenant`; never commit to `master`.
- Before any `git push` or `firebase deploy`: run the account gate (`gh auth status` → tlaphane-1; `firebase login:list` → tlaphane@gmail.com; `supabase projects list` → project `aogdkqczvlffgydgxsmz` present). Any deploy needs the owner's go-ahead in chat first.
- After every task: `npm run lint` and `npm run build` pass.

## Review Focus

1. `TENANT` set to a slug with no folder, or a `tenant.json` missing a required field → the build fails with a message naming the slug/field; it never ships a page saying "undefined". (Test in Task 1.)
2. Returning visitors after deploy → cart, age confirmation, recent orders, analytics ids and the driver-install dismissal are all still found, i.e. every storage key is byte-identical. (Test in Task 1.)
3. `VITE_GOOGLE_MAPS_KEY` not set in a build → Contact page still shows the address and a working "Get directions" link, with no broken map frame. (Test in Task 2.)
4. Fonts move from a CSS `@import` to an HTML `<link>` → headings still render in Playfair Display; if the link were dropped they would silently fall back to serif. (Test in Task 3; checked again in Task 10's render comparison.)
5. `VITE_EFT_BANK_DETAILS` set in the environment → it still overrides the default bank text, as today. (Test in Task 5.)

---

## File Structure

```
tenants/
  loadTenant.mjs            # Node: resolveTenantSlug(), loadTenant(), validateTenant()
  vitePlugin.mjs            # Node: tenantVitePlugin(tenant), renderIndexHtml(html, tenant)
  224clubhouse/
    tenant.json             # every 224 fact used by the website
    public/                 # moved from /public (driver.webmanifest, icons/, favicon.svg, icons.svg)
src/
  tenant.js                 # the ONLY src/ reader of tenant.json: tenant, storageKey(), pageTitle(), adminTitle()
  utils/mapEmbed.js         # mapEmbedUrl(key, query)
  __tests__/
    loadTenant.unit.test.js
    tenant.unit.test.js
    mapEmbed.unit.test.js
    indexHtml.unit.test.js
    theme.unit.test.js
    brandLiterals.unit.test.js   # ratchet: no 224 facts left in src/
scripts/
  compare-builds.mjs        # diff two dist dirs, ignoring asset hashes
  compare-rendered.mjs      # Playwright: diff visible text/title/fonts of two running builds
```

Modified: `vite.config.js`, `index.html`, `tailwind.config.js`, `src/index.css`, `.env.example`, `CLAUDE.md`, `scripts/prerender-seo.mjs`, `scripts/build-driver-icons.mjs`, and ~55 files under `src/` (Tasks 5–9).

### `tenant.json` shape (decided here; every task consumes it)

Top-level keys and their 224 values (copy values verbatim from the files named):

| Key | 224 value / source |
|---|---|
| `slug` | `"224clubhouse"` |
| `name` | `"224 Clubhouse"` |
| `shortName` | `"224"` (used in `"| 224 Admin"`, `"☀️ *224 summary — …*"`) |
| `legalName` | `"224 Clubhouse"` |
| `orderPrefix` | `"224"` |
| `storagePrefix` | `"224"` |
| `legacyStorageKeys` | `{ "age-verified": "age-verified", "recent-orders": "224:recent-orders" }` |
| `domain` | `{ "siteUrl": "https://224clubhouse.store", "apex": "224clubhouse.store", "liveHosts": ["224clubhouse.store", "www.224clubhouse.store", "224clubhouse.web.app"] }` |
| `contact` | `{ "street": "224 Rondebult Road", "suburb": "Libradene", "city": "Boksburg", "postalCode": "1459", "province": "Gauteng", "country": "ZA", "phoneDisplay": "075 086 8783", "phoneTel": "0750868783", "phoneIntl": "+27 75 086 8783", "email": "224clubhous@gmail.com", "mapsLink": <Contact.jsx:30>, "mapQuery": "224 Rondebult Road, Libradene, Boksburg", "mapCentre": [-26.2125, 28.2625] }` |
| `hours` | `{ "status": <Footer.jsx:105>, "delivery": <Footer.jsx:106>, "contactPage": <Contact.jsx:47> }` |
| `social` | `{ "facebook": "https://facebook.com/224clubhouse", "instagram": "https://instagram.com/224clubhouse" }` (use the exact URLs in `Footer.jsx:33,42`) |
| `bank` | `{ "bankName": "FNB", "details": <bankDetails.js:6, with real newlines> }` |
| `images` | `{ "logo", "logoWide", "favicon", "header", "gallery": [...] }` — storage paths relative to the public storage root, exactly as in `useStorageImages.js:16-35` (e.g. `"brand-assets/224-logo-fav-1.png"`), plus `"iconSource": "docs/membership-form/logo.png"` (repo-relative, for driver icons) |
| `theme` | `{ "colors": <tailwind.config.js:2-19, all 12 tokens>, "fonts": { "heading": ["\"Playfair Display\"", "serif"], "body": ["Inter", "sans-serif"], "hand": ["Caveat", "cursive"] }, "googleFontsUrl": <src/index.css:1 URL> }` |
| `seo` | `{ "title": <index.html:7>, "description": <index.html:8>, "locale": "en_ZA", "routes": {...}, "productDescription", "eventDescription" }` — filled in Task 9 from `prerender-seo.mjs` |
| `content` | Page copy, namespaced by page: `content.home.*`, `content.about.*`, `content.membership.*`, `content.footer.*`, `content.ageGate.*`, `content.checkout.*` … Each page task owns its namespace and picks field names. |
| `legal` | `{ "informationOfficer", … }` — Task 8 owns it. |

`validateTenant()` requires: `slug, name, shortName, legalName, orderPrefix, storagePrefix, domain.siteUrl, domain.apex, domain.liveHosts, contact.email, contact.phoneDisplay, contact.street, contact.city, bank.details, images.logo, images.logoWide, images.favicon, theme.colors, theme.fonts, theme.googleFontsUrl, seo.title, seo.description`. Later tasks add the fields they introduce to the required list.

---

## Foundation

### Task 1: Tenant loader, `src/tenant.js`, Vite wiring

**Files:**
- Create: `scripts/compare-builds.mjs` (interface in Task 10), `tenants/loadTenant.mjs`, `tenants/224clubhouse/tenant.json` (keys from the table above that exist by the end of this task: everything except `seo.routes/productDescription/eventDescription`, `content`, `legal`), `src/tenant.js`
- Move: `public/*` → `tenants/224clubhouse/public/` (`git mv`, keep paths below it)
- Modify: `vite.config.js`, `eslint.config.js` (add `tenants/**/*.mjs` to a Node-globals block if lint complains)
- Test: `src/__tests__/loadTenant.unit.test.js`, `src/__tests__/tenant.unit.test.js`

**Interfaces:**
- Produces (Node, `tenants/loadTenant.mjs`):
  - `export const DEFAULT_TENANT = '224clubhouse'`
  - `export function resolveTenantSlug(env = process.env): string` — `env.TENANT?.trim() || DEFAULT_TENANT`; throws `Error('Invalid TENANT "<x>": use lowercase letters, digits and dashes')` unless `/^[a-z0-9-]+$/`.
  - `export function validateTenant(obj, slug): object` — throws `Error('tenants/<slug>/tenant.json: missing required field "<dotted.path>"')` for the first missing/empty required field; throws if `obj.slug !== slug`. Returns `obj`.
  - `export function loadTenant(slug = resolveTenantSlug()): object` — reads `tenants/<slug>/tenant.json`; throws `Error('Unknown tenant "<slug>": tenants/<slug>/tenant.json not found')`; returns `validateTenant(...)`.
  - `export function tenantDir(slug): string` — absolute path of `tenants/<slug>`.
- Produces (browser, `src/tenant.js`):
  - `export const tenant` — the parsed config, `Object.freeze`d (deep freeze).
  - `export function storageKey(name: string): string` — `tenant.legacyStorageKeys?.[name] ?? \`${tenant.storagePrefix}-${name}\``.
  - `export function pageTitle(page: string): string` — `\`${page} | ${tenant.name}\``.
  - `export function adminTitle(page: string): string` — `\`${page} | ${tenant.shortName} Admin\``.
  - `export function storagePublicUrl(path: string): string` — `\`${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/${path}\``.
- Vite: `resolve.alias['@tenant'] = tenantDir(slug)`; `publicDir = path.join(tenantDir(slug), 'public')`. `src/tenant.js` does `import data from '@tenant/tenant.json'`.

- [ ] **Step 0: Record the baseline build (before any change)**

Run: `npm run build && rm -rf ../224-dist-baseline && cp -r dist ../224-dist-baseline`
Expected: build succeeds; `../224-dist-baseline/index.html` exists. This is what every later `compare-builds` run compares against.

- [ ] **Step 1: Write failing tests**

`loadTenant.unit.test.js`:
- `resolveTenantSlug({})` → `'224clubhouse'`; `resolveTenantSlug({ TENANT: ' explosive420 ' })` → `'explosive420'`; `resolveTenantSlug({ TENANT: 'Bad Slug' })` throws `/Invalid TENANT/`.
- `loadTenant('nope')` throws `/Unknown tenant "nope"/`.
- `loadTenant('224clubhouse').name === '224 Clubhouse'`.
- `validateTenant({ ...valid, contact: { ...valid.contact, email: '' } }, '224clubhouse')` throws `/missing required field "contact.email"/`.
- `validateTenant({ ...valid, slug: 'other' }, '224clubhouse')` throws.

`tenant.unit.test.js` (Review Focus 2 — exact keys):
- `storageKey('cart') === '224-cart'`, `storageKey('vid') === '224-vid'`, `storageKey('sid') === '224-sid'`, `storageKey('src') === '224-src'`, `storageKey('driver-install-dismissed') === '224-driver-install-dismissed'`, `storageKey('age-verified') === 'age-verified'`, `storageKey('recent-orders') === '224:recent-orders'`.
- `pageTitle('The Store') === 'The Store | 224 Clubhouse'`; `adminTitle('Orders') === 'Orders | 224 Admin'`.
- `Object.isFrozen(tenant.contact) === true`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/__tests__/loadTenant.unit.test.js src/__tests__/tenant.unit.test.js`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement** `tenants/loadTenant.mjs`, `tenants/224clubhouse/tenant.json`, `src/tenant.js`; wire `vite.config.js` (call `loadTenant()` once at config load so a bad slug fails the build before bundling); `git mv public tenants/224clubhouse/public`.

- [ ] **Step 4: Run tests, lint, build, compare**

Run: `npx vitest run src/__tests__/loadTenant.unit.test.js src/__tests__/tenant.unit.test.js && npm run lint && npm run build && node scripts/compare-builds.mjs ../224-dist-baseline dist`
Expected: tests PASS; `dist/driver.webmanifest` and `dist/icons/driver-192.png` exist (public dir still copied).
Run: `TENANT=nope npm run build`
Expected: fails with `Unknown tenant "nope"`.

- [ ] **Step 5: Commit** — `feat(tenant): per-store config folder, loader and Vite wiring`

## Phase 0 — Hygiene

### Task 2: Google Maps key out of source

**Files:**
- Create: `src/utils/mapEmbed.js`
- Modify: `src/pages/Contact.jsx:206-217`, `.env.example`
- Test: `src/__tests__/mapEmbed.unit.test.js`

**Interfaces:**
- Produces: `export function mapEmbedUrl(key: string | undefined, query: string): string | null` — `null` when `key` is falsy/blank; otherwise `https://www.google.com/maps/embed/v1/place?key=<encodeURIComponent(key)>&q=<encodeURIComponent(query)>`.

- [ ] **Step 1: Failing test** — `mapEmbedUrl(undefined, 'x') === null`; `mapEmbedUrl('  ', 'x') === null`; `mapEmbedUrl('K', '224 Rondebult Road, Libradene, Boksburg') === 'https://www.google.com/maps/embed/v1/place?key=K&q=224%20Rondebult%20Road%2C%20Libradene%2C%20Boksburg'`.
- [ ] **Step 2: Run** `npx vitest run src/__tests__/mapEmbed.unit.test.js` → FAIL.
- [ ] **Step 3: Implement.** Contact reads `import.meta.env.VITE_GOOGLE_MAPS_KEY` and `tenant.contact.mapQuery`; when the URL is `null`, render nothing in place of the iframe (the address card and the existing directions link above it remain — Review Focus 3). Iframe `title` becomes `` `${tenant.name} Location` ``. Add `VITE_GOOGLE_MAPS_KEY=` with a one-line comment to `.env.example` ("Maps Embed API key; restrict to the live hostnames in Google Cloud").
- [ ] **Step 4: Run** test + `npm run lint && npm run build`; then `grep -r "AIzaSy" src dist` → no output.
- [ ] **Step 5: Commit** — `fix(contact): read Maps embed key from env, hide map when unset`

> Owner action before the 224 deploy (Task 10): add `VITE_GOOGLE_MAPS_KEY=<the existing key>` to `.env.local`, and in Google Cloud restrict the key to HTTP referrers `224clubhouse.store/*`, `www.224clubhouse.store/*`, `224clubhouse.web.app/*` (and later each new store's domain). The key remains in git history and in every built page by nature of a Maps embed; the referrer restriction is the real protection. Rotating it is optional.

### Task 3: Fix stale `CLAUDE.md` account section

**Files:** Modify `CLAUDE.md` (the "EFF Election Monitoring App — Claude Rules" heading and the Supabase lines)

- [ ] **Step 1:** Rename the heading to `# Account & deploy rules`. Replace `tlaphane's Project (jqxzhgjazvftgobfqjox)` with `the 224 Clubhouse project (aogdkqczvlffgydgxsmz)` and "projects owned by tlaphane@gmail.com" stays. Do not change any other rule.
- [ ] **Step 2: Verify** `grep -n "EFF\|jqxzhgjazvftgobfqjox" CLAUDE.md` → no output.
- [ ] **Step 3: Commit** — `docs: fix account-gate section copied from another project`

---

## Phase 1 — Config extraction

### Task 4: Theme and `index.html` from the tenant

**Files:**
- Create: `tenants/vitePlugin.mjs`
- Modify: `tailwind.config.js:1-19,41-46`, `src/index.css:1,19,32` (and any other literal `'Inter'` / `'Playfair Display'` in it), `index.html:5-8`, `vite.config.js` (register plugin), `src/pages/About.jsx:39` (the inline `rgba(201,168,76,0.06)` → a Tailwind class using `gold` with opacity, e.g. `bg-gold/[0.06]`, if visually identical; otherwise a CSS variable from the theme)
- Test: `src/__tests__/indexHtml.unit.test.js`, `src/__tests__/theme.unit.test.js`

**Interfaces:**
- Produces: `export function renderIndexHtml(html: string, tenant: object): string` — replaces `%TENANT_TITLE%` and `%TENANT_DESCRIPTION%` (HTML-attribute-escaped) and replaces `<!-- %TENANT_FONTS% -->` with `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="<googleFontsUrl>">`. Throws if any placeholder is absent.
- Produces: `export function tenantVitePlugin(tenant): import('vite').Plugin` — `transformIndexHtml` calls `renderIndexHtml`.
- `tailwind.config.js` keeps `export default` shape; `colors` = `loadTenant().theme.colors`, `fontFamily.heading/body/hand` from `theme.fonts`. `src/utils/toastTheme.js` keeps working unchanged (it imports the config).
- `index.css` uses `theme('fontFamily.body')` / `theme('fontFamily.heading')` instead of literal families.

- [ ] **Step 1: Failing tests**
  - `indexHtml`: given `'<title>%TENANT_TITLE%</title><meta name="description" content="%TENANT_DESCRIPTION%" /><!-- %TENANT_FONTS% -->'` and the 224 tenant, output contains `<title>224 Clubhouse | Private Cannabis Members&#39; Club</title>` **or** the unescaped title (match what the baseline `index.html` emits — check `../224-dist-baseline/index.html` and assert that exact title text), contains the description from `index.html:8`, and contains the fonts stylesheet link exactly once (Review Focus 4). Missing placeholder → throws.
  - `theme`: `(await import('../../tailwind.config.js')).default.theme.extend.colors` deep-equals `{ background: '#0a0a0a', surface: '#111111', gold: '#C9A84C', 'gold-light': '#e2c074', muted: '#888888', border: '#222222', leaf: '#7CC242', 'leaf-deep': '#1B2E12', paper: '#FBF8F1', 'paper-line': '#CFC8B8', print: '#1C1C1C', ink: '#1D3D8F' }`; `fontFamily.heading` deep-equals `['"Playfair Display"', 'serif']`.
- [ ] **Step 2: Run** both → FAIL.
- [ ] **Step 3: Implement.** `index.html` gets the three placeholders; the favicon `<link>` stays.
- [ ] **Step 4: Run** tests, lint, build. `grep -c "fonts.googleapis.com/css2" dist/index.html` → `1`; `grep -c "@import" dist/assets/*.css` → `0` for the fonts URL.
- [ ] **Step 5: Commit** — `feat(tenant): theme colours, fonts and index.html from tenant config`

### Task 5: Brand-literal ratchet test + utils and hooks

**Files:**
- Create: `src/__tests__/brandLiterals.unit.test.js`
- Modify: `src/utils/bankDetails.js`, `src/context/cartReducer.js:6`, `src/utils/ageGate.js:1`, `src/utils/recentOrders.js:16`, `src/utils/analytics.js:8-13,44`, `src/utils/staffWhatsApp.js:15,61-66,100`, `src/utils/whatsappOrder.js:39,55`, `src/hooks/useStorageImages.js:9-37`, `src/hooks/useMemberships.js:136`, `src/hooks/useOrderTracking.js:11`
- Test: existing `src/utils/*.test.js`, `src/__tests__/whatsappOrder.test.js`, `src/__tests__/cartClear.unit.test.js` must pass **unmodified** (they are the proof 224 output is unchanged).

**Interfaces:**
- Consumes: `tenant`, `storageKey`, `storagePublicUrl` from Task 1.
- Produces: `brandLiterals.unit.test.js` exports nothing; it builds its forbidden list from the 224 `tenant.json` at runtime: `name`, `domain.apex`, `contact.street`, `contact.phoneDisplay`, `contact.phoneTel`, `contact.phoneIntl`, the WhatsApp digits `27750868783`, `contact.email`, the account number line from `bank.details` (`63228491138`), `'aogdkqczvlffgydgxsmz'`, `'facebook.com/224clubhouse'`, `'instagram.com/224clubhouse'`, `` `${shortName} Admin` ``, `'Boksburg'`, `'Rondebult'`, `'FNB'`. It scans `src/**/*.{js,jsx}` except `src/__tests__/**`, `**/*.test.js`, and `src/tenant.js`, and fails listing `file:line: "<literal>"` for every hit. It also fails on the regexes `` /['"`]224[-:]/ `` (literal order/storage prefixes).
- `BANK_DETAILS` keeps its current export and env-override semantics; default comes from `tenant.bank.details`.
- `BRAND_IMAGES` keeps its shape; URLs come from `storagePublicUrl(tenant.images.*)`. The hard-coded fallback project URL is removed.
- `staffWhatsApp.js`: `SITE = tenant.domain.siteUrl`; "check FNB" → `` `check ${tenant.bank.bankName}` ``; summary line uses `tenant.shortName`.
- `whatsappOrder.js`: `` `*${tenant.name} order*` `` and `` `sent from ${tenant.domain.apex}` ``.
- `analytics.js`: `LIVE_HOSTS = tenant.domain.liveHosts`; `host.endsWith(tenant.domain.apex)`.

- [ ] **Step 1: Write `brandLiterals.unit.test.js`.**
- [ ] **Step 2: Run** `npx vitest run src/__tests__/brandLiterals.unit.test.js` → FAIL listing ~60 files. Save the file list into the task notes; Tasks 5–8 burn it down.
- [ ] **Step 3: Add a Review Focus 5 test** to `src/utils/` (new `bankDetails.test.js`): with `vi.stubEnv('VITE_EFT_BANK_DETAILS', 'Bank: X\\nAcc: 1')` and a fresh import, `BANK_DETAILS === 'Bank: X\nAcc: 1'`; with it unset, `BANK_DETAILS === tenant.bank.details.trim()`.
- [ ] **Step 4: Replace the literals** in the files listed for this task.
- [ ] **Step 5: Run** `npx vitest run src/utils src/__tests__/whatsappOrder.test.js src/__tests__/cartClear.unit.test.js src/__tests__/tenant.unit.test.js` → PASS with no test file edited; `brandLiterals` output no longer lists any file from this task.
- [ ] **Step 6: Lint, build, commit** — `refactor(tenant): utils and hooks read store facts from tenant config`

### Task 6: Layout and shared components

**Files (modify):** `src/components/layout/Footer.jsx`, `Navbar.jsx`, `AgeGate.jsx`, `src/components/ui/BrandLogo.jsx`, `src/components/auth/CustomerAuth.jsx:62`, `src/components/checkout/CheckoutForm.jsx:73`, `PaystackButton.jsx:8`, `src/components/delivery/InstallDriverApp.jsx:8,18`, `LiveMap.jsx:8`, `src/components/admin/EventForm.jsx:10`, `EftAdminPanel.jsx:28,120`, `src/components/membership/PaperApplication.jsx`, `paperForm.js:14,18`

**Interfaces:**
- Consumes: `tenant`, `storageKey` (Task 1); `BRAND_IMAGES` (Task 5).
- Produces: `content.footer.*`, `content.ageGate.*`, `content.paperForm.*` keys in `tenant.json` (names chosen here, values verbatim). Payment reference: `` `${tenant.orderPrefix}-${Date.now()}…` ``; `LiveMap` centre `tenant.contact.mapCentre`; `EventForm` default location built from `contact` exactly as today's string; `InstallDriverApp` key `storageKey('driver-install-dismissed')` and title `` `${tenant.shortName} Driver` ``.

- [ ] **Step 1:** Replace literals; add the content keys.
- [ ] **Step 2: Run** `npx vitest run src/__tests__/brandLiterals.unit.test.js` → none of this task's files listed. `npm run lint && npm run build` pass.
- [ ] **Step 3: Commit** — `refactor(tenant): layout and shared components read tenant config`

### Task 7: Storefront and driver pages

**Files (modify):** `src/pages/Home.jsx`, `About.jsx`, `Membership.jsx`, `Contact.jsx`, `Cart.jsx`, `Checkout.jsx`, `Events.jsx`, `EventDetail.jsx`, `ProductDetail.jsx`, `Store.jsx`, `TrackOrder.jsx`, `Unsubscribe.jsx`, `Invoice.jsx`, `Account.jsx`, `Login.jsx`, `MyOrders.jsx`, `NotFound.jsx`, `OrderConfirmation.jsx`, `OrderDetail.jsx`, `ResetPassword.jsx`, `src/pages/driver/DriverPortal.jsx`

**Interfaces:**
- Consumes: `tenant`, `pageTitle` (Task 1).
- Produces: `content.home.*` (testimonials array, hero, gallery heading, newsletter copy), `content.about.*` (timeline array, values array, story paragraphs), `content.membership.*` (house rules array, intro), `content.checkout.*`, `content.memberOnly.*` (the "reserved for active … members" lines). Every `document.title = '<X> | 224 Clubhouse'` → `document.title = pageTitle('<X>')`. Membership reference `` `${tenant.orderPrefix}-mem-…` ``; TrackOrder placeholder `` `${tenant.orderPrefix}-XXXXXX` ``.

- [ ] **Step 1:** Replace literals page by page; add content keys.
- [ ] **Step 2: Run** `brandLiterals` → none of this task's files listed; lint + build pass.
- [ ] **Step 3: Commit** — `refactor(tenant): storefront pages read tenant config`

### Task 8: Legal pages and admin pages

**Files (modify):** `src/pages/legal/Terms.jsx`, `PrivacyPolicy.jsx`, `DeliveryReturns.jsx`, `LegalPage.jsx:16,44`; `src/pages/admin/*.jsx` (titles in all 13; `Dashboard.jsx:42,62`, `Alerts.jsx:108,171`, `Memberships.jsx:556,573`, `Drivers.jsx:51,90`)

**Interfaces:**
- Consumes: `tenant`, `pageTitle`, `adminTitle` (Task 1).
- Produces: `legal.*` in `tenant.json` — only the store-specific facts the pages interpolate (`informationOfficer`, any effective dates); company name/address/phone/email come from `legalName`/`contact`. The legal text itself stays in the shared components (same business type for all stores, spec §2 non-goals). Shipping amounts in `DeliveryReturns`/`Terms` stay as they are (shared rule, not tenant).
- Admin titles: `document.title = adminTitle('<X>')`.

- [ ] **Step 1:** Replace literals.
- [ ] **Step 2: Run** `npx vitest run src/__tests__/brandLiterals.unit.test.js` → **PASS** (zero hits). If anything remains anywhere in `src/`, fix it in this task.
- [ ] **Step 3:** Add `brandLiterals.unit.test.js` to the `predeploy` and `test:contract` lists in `package.json` (before `rlsEmbedAudit.test.js`).
- [ ] **Step 4: Lint, build, commit** — `refactor(tenant): legal and admin pages read tenant config`

### Task 9: Build scripts read the tenant

**Files (modify):** `scripts/prerender-seo.mjs:23-26,95,165-180,216,237,253-286`, `scripts/build-driver-icons.mjs:10,16`, `tenants/224clubhouse/tenant.json` (`seo.routes`, `seo.productDescription`, `seo.eventDescription`)

**Interfaces:**
- Consumes: `loadTenant()` (Task 1).
- `prerender-seo.mjs`: `SITE = tenant.domain.siteUrl`, `SITE_NAME = tenant.name`, locale `tenant.seo.locale`, per-route descriptions `tenant.seo.routes[path]`, product/event description templates as strings with `{name}`-style tokens (implementer picks the token syntax), JSON-LD address from `tenant.contact`, logo `tenant.images.logoWide`. Remove `FALLBACK_SUPABASE_URL`; when `VITE_SUPABASE_URL` is absent keep today's behaviour (warn, write static pages, exit 0).
- `build-driver-icons.mjs`: logo from `tenant.images.iconSource`, `BG = tenant.theme.colors.background`, output to `tenants/<slug>/public/icons/`.

- [ ] **Step 1:** Implement.
- [ ] **Step 2: Run** `npm run build`, then `node scripts/compare-builds.mjs ../224-dist-baseline dist` → no differences in any `*.html` except asset hash names.
- [ ] **Step 3: Run** `node scripts/build-driver-icons.mjs` → the three PNGs regenerate; `git diff --stat` shows them either unchanged or binary-changed with identical pixels (open one to check by eye).
- [ ] **Step 4: Commit** — `refactor(tenant): SEO prerender and driver icons read tenant config`

### Task 10: Prove 224 is unchanged, then ship to 224

**Files:**
- Create: `scripts/compare-rendered.mjs` (`scripts/compare-builds.mjs` already exists from Task 1; its interface is documented here)

**Interfaces:**
- `node scripts/compare-builds.mjs <dirA> <dirB>` — lists files present in only one side (ignoring `assets/*-<hash>.*` names, matched by base name), and for every `.html`/`.webmanifest`/`.xml`/`.txt` file, a unified diff after replacing `/assets/<name>-<hash>.<ext>` with `/assets/<name>.<ext>`. Exit 1 on any difference.
- `node scripts/compare-rendered.mjs <urlA> <urlB>` — Playwright Chromium, phone viewport 390×844, sets `localStorage['age-verified']='true'` before load; for routes `/`, `/store`, `/events`, `/membership`, `/about`, `/contact`, `/cart`, `/track`, `/terms`, `/privacy`, `/delivery-returns`, `/login`, `/admin/login`, `/orders`, `/does-not-exist` (adjust to the real router paths in `App.jsx`), and the first product and event detail pages found on `/store` and `/events`: compares `document.title`, `document.body.innerText` (whitespace-normalised), and the computed `font-family` of the first `h1`/`h2`. Fails if texts differ or if either page's text contains the words `undefined` or `[object Object]`. Exit 1 on any difference.

- [ ] **Step 1:** Write `compare-rendered.mjs`.
- [ ] **Step 2: Run** `npm run build && node scripts/compare-builds.mjs ../224-dist-baseline dist` → exit 0.
- [ ] **Step 3: Run** `npx vite preview --outDir ../224-dist-baseline --port 4174` and `npx vite preview --port 4175` (both in background), then `node scripts/compare-rendered.mjs http://localhost:4174 http://localhost:4175` → exit 0. (Gallery or product order differing between loads is a false alarm only if a re-run passes; investigate otherwise.)
- [ ] **Step 4: Run** `npm run lint` and `npm run predeploy` → all pass (contract suites run against the live DB exactly as today; nothing in them changed).
- [ ] **Step 5: Commit** — `test(tenant): build and render comparison scripts`
- [ ] **Step 6: Owner check-in.** Confirm `VITE_GOOGLE_MAPS_KEY` is in `.env.local` (owner action from Task 2). Run the account gate. With the owner's go-ahead, `firebase hosting:channel:deploy multi-tenant-p1 --site 224clubhouse --expires 7d`, send the preview URL, and have the owner check it on a phone.
- [ ] **Step 7: Ship.** With the owner's go-ahead: push the branch, open a PR to `master`, merge, `firebase deploy --only hosting --non-interactive`. Then `node scripts/compare-rendered.mjs https://224clubhouse.web.app http://localhost:4174` → exit 0. Rollback if anything is off: `firebase hosting:rollback --site 224clubhouse`.
- [ ] **Step 8:** Record the outcome in `OPEN_ITEMS.md` (phase 1 done, date, preview/live checks passed) and commit.
