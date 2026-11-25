# Collect-only fulfilment for a store (Explosive 420)

Date: 2026-11-24 · Status: draft, awaiting owner approval

## Intent and the why

Explosive 420 (tenant `explosive420`) asked us to switch off delivery because it is "too risky".
They still want customers to order online, then **collect at the club** (702 Aubrey Matlakala St,
Soshanguve Block L, Mon–Sun 09:00–22:00). 224 Clubhouse keeps delivery exactly as it is today.

Success: an E420 customer can place an order without being asked for an address or charged a
delivery fee, is told where and when to collect, is emailed when it is ready, and nothing on the
E420 site, emails or admin suggests delivery or drivers. 224 is byte-for-byte unchanged in
behaviour.

## Goals

- A per-store fulfilment mode: `delivery` (default, 224) or `collect` (E420).
- Server-enforced: in collect mode `place_cod_order` charges **R0** fulfilment fee and stores no
  delivery address, whatever the client sends.
- Customer-facing wording in collect mode: checkout, cart, order confirmation, `/orders`,
  order detail, `/track`, invoice, order + status emails, Delivery & Returns / Terms / Privacy.
- Driver features hidden in collect mode: Admin → Drivers nav + route, driver assignment and
  location on admin orders, location pin at checkout, live driver tracking for customers,
  `/driver` portal.
- Reversible: flipping the mode back to `delivery` restores today's behaviour with no code change.

## Non-goals

- No new order statuses or payment-method values in the database (that was approach B, rejected).
- No automatic expiry of uncollected orders. The admin cancels by hand; cancelling already
  restores stock.
- No collection time-slot booking.
- No deletion of existing E420 driver accounts or data (hidden, not destroyed). The owner can
  remove driver accounts separately if they want.
- No change to Paystack / online payment (still disabled).

## Anti-goals

- Any change in 224's checkout, pricing, statuses, emails or driver features.
- A client-only switch: a modified client must not be able to get delivery from a collect store,
  or get a free-delivery total from a delivery store.
- Leftover "delivery", "driver" or "out for delivery" wording anywhere an E420 customer can see it.

## Constraints

- Money in integer cents. Server recomputes totals (never trust client totals).
- Tenant facts live in `tenants/<slug>/tenant.json` (browser) and the `tenants` table (server);
  no store literals in `src/` (`brandLiterals.unit.test.js`).
- `place_cod_order` currently hard-codes `3000` fee / `50000` threshold
  (`supabase/migrations/20261102140000_tenant_rpcs_orders.sql:229`). Keep that for delivery
  stores; do not refactor it beyond adding the collect branch.
- Mobile-first (390/360 px, 44 px taps). UI must follow `docs/DESIGN_SYSTEM.md` tokens; run the
  `ui-reviewer` subagent before done.
- Deploy DB migration and frontend together (frontend relies on the new column).

## Approaches considered

- **A. Same status/payment values, store-specific labels (chosen).** DB keeps
  `out_for_delivery` / `delivered` and `cash_on_delivery` / `card_on_delivery`. In collect mode
  the UI and emails label them "Ready for Collection", "Collected", "Cash on Collection",
  "Card on Collection". Reports, sales totals, filters, purge jobs and existing orders keep working
  untouched. Trade-off: the stored value `delivered` means "collected" for E420; documented here
  and in a code comment at the label map.
- **B. New statuses / payment methods in the DB.** Accurate data, but touches check constraints,
  RPCs, reports, sales summary, analytics and emails — roughly double the work and risk. Rejected
  for now; can migrate later if collect mode becomes permanent.
- **C. Hide the address fields client-side only.** Rejected: server would still charge R30 and the
  switch would be bypassable.

Owner picked **A** (2026-11-24).

## Design (decided)

### The switch

- `tenant.json`: `delivery.mode`: `"delivery"` | `"collect"`. Explosive 420 → `"collect"`;
  224 → `"delivery"`. `loadTenant.mjs` validation accepts both, defaulting to `delivery` only if
  the reference shape allows; preferred: required key in both files.
- `tenants` table: new column `fulfilment text not null default 'delivery'
  check (fulfilment in ('delivery','collect'))`; migration sets `explosive420` to `collect`.
  Helper `public.tenant_fulfilment()` (stable, same style as `tenant_min_age()`).
- `src/tenant.js` exports a single `IS_COLLECT` (or `fulfilmentMode`) that all UI reads.

### Server (`place_cod_order`, new migration, `create or replace`)

- When `tenant_fulfilment() = 'collect'`: `v_shipping := 0`, `shipping_address := null` (ignore
  any address in `p_customer`), and skip street/address validation if any exists server-side.
- Delivery stores: unchanged.
- `set_order_pin` and `geocode-order`: refuse / no-op for collect stores (defence in depth, so no
  location data is collected).
- Payment methods allowed stay the same three values.

### Checkout and cart

- Collect mode: no street / apartment / suburb / city / postal fields, no "Use my location",
  section titled "Contact & Collection" (name, phone, locked email). A "Collect from" card shows
  the club address (`tenant.contact`), a Maps link (`contact.mapsLink`) and hours
  (`tenant.hours.status`).
- Order summary shows no delivery/shipping line (fee is 0); cart drops "free delivery from R500"
  messaging.
- Payment options labelled "Cash on Collection", "Card on Collection", "EFT (Bank Transfer)";
  payment note: "No payment now — you'll pay by cash/card when you collect."

### Labels (approach A)

- `src/utils/orderStatus.js`: status and payment labels resolved through the tenant mode.
  Collect: `out_for_delivery` → "Ready for Collection", `delivered` → "Collected",
  `cash_on_delivery` → "Cash on Collection", `card_on_delivery` → "Card on Collection".
  Timeline steps keep the same keys.
- Every place that renders statuses/payment methods uses these helpers (confirm none render raw
  strings or their own copy).

### Customer order views

- `/orders`, order detail, `/track`, order confirmation, invoice: no address block, no live map /
  `DeliveryTracker`; show the "Collect from" card while the order is not yet collected or
  cancelled.

### Emails (`send-order-email`, `send-status-email`)

- Edge functions read the order's tenant fulfilment mode (from the `tenants` row).
- Collect copy: confirmation tells them where/when to collect and that we'll email when ready;
  `out_for_delivery` email → "Your order is ready for collection" with address + hours;
  `delivered` → "Collected — thanks". No "nearby driver" copy. Owner new-order alert: no address
  or pin, says "Collection".

### Admin

- Hide Drivers nav item and route, `DriverAssign`, `OrderLocation`, any driver/map widgets on
  orders/alerts. Status buttons use the collect labels. Staff WhatsApp templates
  (`staffWhatsApp.js`, `OrderWhatsAppActions.jsx`) use collect wording.
- `/driver` portal: route not registered (or redirects home) in collect mode.

### Legal / content pages

- Delivery & Returns becomes "Collection & Returns" content for collect stores (route stays
  `/delivery-returns` so links don't break; SEO title from `tenant.json`). Terms and Privacy:
  collect-mode wording; Privacy drops delivery address / location pin / driver position from
  "data we hold" for collect stores. Bump `legal.lastUpdated` for E420.
- Home / product / membership pages: remove any delivery promises in collect mode.

## Calls made after the builder check (Claude's calls, owner to confirm)

- **Address column:** `orders.shipping_address` is `jsonb not null`. Collect orders store `'{}'::jsonb`;
  no schema change, so 224's readers are untouched. Collect-mode UI never renders the address.
  (Supersedes "shipping_address := null" above.)
- **Driver RPCs blocked server-side too:** the `driver_*` RPCs refuse for collect stores, and
  `send-status-email` skips the `nearby` path for them. Admins mark orders ready/collected from
  Admin → Orders (the normal status update), not through driver RPCs.
- **Source of truth:** the `tenants.fulfilment` column is authoritative for the server
  (`place_cod_order`, driver RPCs, `set_order_pin`). The browser and edge functions read
  `delivery.mode` from `tenant.json` (edge functions via the existing generated
  `_shared/stores.generated.ts`). A unit test asserts every tenant's `delivery.mode` matches the
  value its migration sets. "Flip back" therefore means a config change + migration + redeploy,
  not zero change.
- **WhatsApp order panel:** `WhatsAppOrderPanel.jsx` uses its existing "Collection" branch in
  collect mode (no address prompt).
- **Membership perk (owner, 2026-11-24):** E420's tiers promise free delivery. That perk is
  replaced by **"Free rolling paper when you stay at the lounge"**. Tier perks are DB rows edited
  in Admin → Memberships, so this is a rollout step (edit each E420 tier at deploy time), not code.
  The server's member-free-delivery rule is moot in collect mode (fee is always 0).
- **Telegram:** out of scope. E420 has `telegram: false`; collect-mode Telegram copy is left for
  if it is ever switched on.

## Left to the builder

- Exact component split (e.g. a shared `CollectFromCard`), file-by-file wiring, test design.
- Whether `IS_COLLECT` gates via a hook or a constant (constant is fine: tenant is build-time).
- Copy wording beyond what is quoted above (keep it short, plain, phone-friendly).

## Rollout

1. Before deploying, check for E420 orders still in `confirmed` / `preparing` /
   `out_for_delivery` with an address; the owner tells the club to finish or contact those
   customers. Existing orders keep their stored address in the DB but the UI shows collection
   wording.
2. Deploy migration + both store builds together, after the account checks in `CLAUDE.md`.
   Same session: edit each E420 membership tier's perks in Admin → Memberships, replacing
   free delivery with "Free rolling paper when you stay at the lounge".
3. Test on a phone via a Firebase preview channel for E420 before going live; one real test order
   end to end (place → ready email → collected).
4. Update `OPEN_ITEMS.md` §7d (drivers no longer used by E420) and the E420 handover pack.
