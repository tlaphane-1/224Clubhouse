# Store upgrades — Shopstar-gap features (2026-10-05)

Owner request: add six features, then deploy. Online payment is out of scope (not yet approved).
Branch: `feature/store-upgrades`.

## Decisions taken (owner can change any of these)

- **Variants**: a `product_variants` table (label, price, stock). A trigger keeps
  `products.price` = cheapest available option and `products.stock_quantity` = the sum, so
  listings, sorting and "out of stock" keep working. A product with no variants behaves exactly
  as today. `place_cod_order` prices and decrements the chosen variant; cancel restocks it.
- **Reports**: computed in the browser from admin-readable `orders` + `products`. "Revenue" counts
  delivered orders (matches the dashboard: COD money arrives at delivery). Low stock = 5 or fewer.
- **Abandoned cart**: only for signed-in customers. Cart is saved to `saved_carts`; an hourly
  pg_cron job calls the `send-cart-reminders` Edge Function, which emails once per cart, 3h after
  it was last changed, if no order was placed since. Every email has a one-click opt-out.
- **SEO/link previews**: the SPA has no server, so a post-build script writes a static HTML copy
  per product and event with its own title, description and photo (WhatsApp/Google read these),
  plus `sitemap.xml` and `robots.txt`. Snapshots refresh on every deploy.
- **Invoices**: printable invoice page per order (`/orders/:id/invoice`), "Save as PDF" via the
  browser's print dialog. Titled "Invoice", not "Tax invoice" — no VAT number on record.
- **Reviews**: only customers with a delivered order containing the product can review it, once.
  Reviews are hidden until an admin approves them (`/admin/reviews`). Public reads go through an
  RPC that never exposes user ids or emails.

## Checklist

- [x] 1 Variants — migration, RPC, restock, admin form, product page, cart, emails, tests
- [x] 2 Reports — `/admin/reports`, low-stock on dashboard, orders CSV
- [x] 3 Abandoned cart — table + RLS, cart sync, edge function, cron, opt-out, tests
- [x] 4 SEO — prerender script, sitemap, robots, build wiring
- [x] 5 Invoices — invoice page, links from order detail + admin orders
- [x] 6 Reviews — table + RPCs, product page section, admin moderation, tests
- [x] lint + build + contract tests
- [x] account checks, `supabase db push`, functions deploy, Firebase preview
- [ ] Firebase live deploy, PR + merge (in progress)

## Review

- Migrations dry-run inside a rolled-back transaction on the live DB, then pushed.
- `storeUpgrades.contract.test.js`: 14/14 live tests pass (variants pricing/stock/restock, cart
  RLS + reminded_at pinning + claim is service-only, review gating + public RPC field whitelist +
  anon negative control). Full contract run: 114 passed; 1 newsletter test hit the known 90s
  network-freeze timeout (OPEN_ITEMS §3.1) and passed on re-run.
- Cron path verified end to end: no secret → 401; cron-style call → 200 `{claimed:0}`.
- Preview channel: SEO pages 200 with no redirect, per-product title/og:image; storefront pages
  have no horizontal scroll at 360/390px.
- NOT verified in a browser: admin screens (Reports, Reviews, product Options editor) and the
  invoice print layout — they need a signed-in admin/customer. No product has options yet, so the
  option picker has only been exercised by unit + contract tests.
