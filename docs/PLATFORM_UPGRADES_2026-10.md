# 224 Clubhouse — Platform Upgrades (Oct 2026)

Oct 7, 2026 · exported from the shared doc: https://claude.ai/code/artifact/e071ec01-d055-45e7-b7ce-869d13752283

## Summary

Between 5 and 7 October 2026, around the public launch, 224clubhouse.store gained 12 pull requests of upgrades. Highlights: product options, verified EFT payments, a driver portal with live tracking, visitor analytics, a server-enforced 21+ check and owner alerts by email and WhatsApp. Every change went through a GitHub pull request on `tlaphane-1/224Clubhouse`. Each was tested against the live database and deployed to production the same day.

| Date | PR | What shipped |
| --- | --- | --- |
| 2026-10-07 | #21 | One-tap WhatsApp shares for staff: send a job to a driver, share an order, EFT check, delivery update or today's summary |
| 2026-10-07 | #20 | Telegram group alerts (built, switched off — WhatsApp shares chosen instead) |
| 2026-10-07 | #19 | 21+ age check enforced on every order; low-stock, review and 07:00 daily-summary alerts; driver app install, ETA and "driver nearby" email; fixed a setting that blocked location site-wide |
| 2026-10-07 | #18 | Admins can also use the driver portal |
| 2026-10-07 | #17 | Driver portal with live delivery tracking for customers and admin |
| 2026-10-07 | #16 | Club email changed to 224clubhous@gmail.com everywhere |
| 2026-10-07 | #14 | EFT payment reference is the customer's name and surname |
| 2026-10-07 | #13 | First-party visitor analytics; email-only order lookup retired |
| 2026-10-07 | #12 | EFT verification: proof-of-payment upload, admin confirmation, dispatch gate |
| 2026-10-07 | #11 | Bank details shown at checkout and on every unpaid EFT order |
| 2026-10-06 | #10 | Bank details on invoices |
| 2026-10-05 | #9 | Product options, sales reports, abandoned-cart reminders, SEO and link previews, invoices, product reviews |

PR #15 (alert diagnostics) was folded into #19 and closed.

## Storefront

Customers can now pick sizes or flavours, read and write reviews, share product links that preview properly, download invoices, and must be 21+ on record to order.

| Feature | What the customer sees | How it works |
| --- | --- | --- |
| Product options | Pick 1g / 3.5g / 7g (or flavours), each with its own price and stock; cards say "From R…" and "Choose" | Options live in `product_variants`. A trigger keeps the product's price (cheapest available option) and stock (total) in step. Checkout prices and decrements the chosen option; cancelling an order puts it back |
| Reviews | Star rating and text on the product page | Only customers with a delivered order for that product can review it. Nothing shows until an admin publishes it. The public sees display name, stars, text and date only |
| SEO and link previews | WhatsApp, Facebook and Google show each product's own title, description and photo | Every build writes a static page per product and event, plus `sitemap.xml` and `robots.txt`. Previews refresh on each deploy |
| Invoices | "View / download invoice" on each order → Save as PDF | A4 invoice titled "Invoice" (not "Tax invoice": no VAT number on record), with banking details and the payment reference |
| 21+ age check | Date of birth at signup; existing customers are asked once at their next checkout | `place_cod_order` refuses any account without a 21+ date of birth in `customer_profiles`. The date can't be changed once set. 3 members were filled in from their membership forms |

## Payments (EFT)

An EFT order can't be prepared, sent out or delivered until an admin confirms the money reached the FNB account. The database enforces this, so no screen can skip it. Online card payment is still off until a provider accepts the business.

**Payment reference:** the customer's **name and surname** (owner decision, 7 Oct; it was the order number before). Names aren't unique, so match on amount and date too.

**Where customers see the bank details:** at checkout as soon as they pick EFT, on the confirmation page (even after a refresh), on their order page, on Track Order, on the invoice and in the receipt email. Once paid, the details disappear and the order shows "Payment received".

The EFT journey:

1. Customer places an EFT order. The order shows **Awaiting EFT** in admin.
2. Customer pays, and can optionally upload proof of payment (photo, screenshot or PDF, up to 5 MB) on their order page. It is stored in a private bucket only they and admins can open. The club is alerted, and the order shows **EFT proof to check**.
3. An admin checks the **FNB app** for the reference and amount. A proof of payment is the customer's claim, not evidence: they can be faked.
4. Admin → Orders → **EFT to check** → open the order → confirm the amount → **Payment received**. The customer is emailed and the order shows **EFT paid**. There is an Undo, but only until the order moves past Confirmed.
5. The order can now move to Preparing, be assigned to a driver and go out.

## Customers and privacy

Signed-in carts now follow customers between devices and get one reminder email. The email-only order lookup is gone. Visits are counted without cookies. The privacy policy was updated for each change.

- **Saved carts and reminders:** a signed-in customer's cart is saved and restored on another device, rebuilt with today's prices and stock. Every hour, one reminder email goes to carts left alone for 3+ hours, if no order was placed since. Each email has a one-click "Stop cart reminders" link. Carts are deleted when emptied or ordered, and automatically 30 days after their last change.
- **Email-only lookup retired:** anyone who guessed an email used to be able to list that customer's orders. Track Order now needs the order number **and** the email; signed-in customers use My Orders.
- **Visitor analytics:** a random ID in the browser counts visits. It isn't linked to a name, email, account or IP. Admins and admin pages aren't counted. Records are kept 13 months.

Personal data the platform now holds, all described in the privacy policy:

| Data | Why | Kept |
| --- | --- | --- |
| Date of birth (`customer_profiles`, memberships) | Confirm customers are 21+ | While the account exists |
| SA ID numbers (memberships) | Membership verification | Membership period + a reasonable time |
| Proof-of-payment files (private bucket) | Match EFT payments | Until deleted by an admin |
| Saved carts | Cross-device cart, one reminder | 30 days after last change |
| Driver's latest position | Live delivery map | Deleted when the last delivery is done; swept daily |
| Anonymous site-usage events | Visitor numbers | 13 months |

## Admin tools

The admin area gained five new pages and a set of alerts. Alerts go by email to **224clubhous@gmail.com** (no "e" before the @), and staff can push any order to WhatsApp in one tap.

| Page | What it's for |
| --- | --- |
| Dashboard | Totals, plus banners for EFT payments to check and low stock (5 or fewer), and a **Share today's summary** WhatsApp button |
| Reports | Revenue (delivered) vs booked over time, best sellers, payment split, low stock, orders CSV download |
| Visitors | Visitors and page views per day, where visitors came from, top pages, phone vs desktop, new accounts, shopping funnel (visited → cart → checkout → ordered) |
| Orders | "EFT to check" filter, payment badges, proof viewer and **Payment received**, driver picker, WhatsApp buttons |
| Drivers | Create driver logins, enable/disable, live map of drivers on the road |
| Reviews | Publish, reject or delete reviews (only published ones show) |
| Alerts | Telegram group setup — built but switched off |

**Email alerts to the club:**

- New order, with any items that just dropped to 5 or fewer in stock
- Proof of payment uploaded
- Review waiting for approval
- Membership application
- **Daily summary at 07:00:** yesterday's visitors, orders and revenue, plus what's waiting (EFT, reviews, memberships, low stock)

**WhatsApp share buttons** (Admin → Orders, open an order): **Send job to [driver]** opens a chat with the driver, pre-filled with the address, a Maps link, the customer's number, the items and what to collect. **Share order**, **Share EFT check** and **Share delivery update** go to whichever chat you pick. A person taps Send every time, so this stays within WhatsApp's rules and puts no number at risk. Fully automatic WhatsApp was ruled out: Meta's business rules don't allow cannabis sellers, and unofficial bots get numbers banned.

**Tip:** links shared with `?utm_source=whatsapp` (e.g. `224clubhouse.store/store?utm_source=whatsapp`) are counted as WhatsApp in Visitors. Otherwise links opened inside WhatsApp show as "Direct".

## Delivery and live tracking

Drivers work from **224clubhouse.store/driver** on their phone, and customers watch the driver on a live map while the order is out for delivery. No app store or map account is needed.

Order to door (the shared doc has this as a drawing):

```
Customer orders ──► Paid by EFT? ──yes──► Customer pays EFT ──► Admin checks FNB
                         │                (may upload proof)          │ paid
                         └── no: cash or card on delivery ──────────► Admin assigns driver
                                                                      (Send job on WhatsApp)
                                                                            │
          Delivered ◄────────────── Driver starts delivery ◄────────────────┘
      (customer emailed)       (customer sees live map + ETA;
                                "driver nearby" email at ~1 km)
```

Cash and card orders skip the payment check and go straight to a driver. EFT orders wait for the admin's FNB check.

**The driver portal shows each driver only the orders assigned to them:**

- **Call** the customer, or **Navigate** (opens Google Maps)
- What to collect: "Collect R60 · Cash", "Paid by EFT — collect nothing", or "EFT not paid yet" (the Start button stays locked)
- **Start delivery:** marks it Out for delivery, emails the customer and starts sharing location every 10 seconds (the screen is kept awake)
- **Delivered:** completes it, emails the customer and stops sharing
- Installable like an app ("Install app" on Android, Share → Add to Home Screen on iPhone)

**The customer sees:**

- A live map with the driver and their home, refreshed every 10 seconds
- Distance and "about N min" (rough: straight line × 1.3 at 30 km/h), then "Arriving now" under 150 m
- One "Your driver is nearby" email when the driver is within about 1 km

**The admin:**

- Creates driver logins at Admin → Drivers (name, phone, email, password)
- Assigns each order on Admin → Orders, then taps **Send job** to WhatsApp the driver
- Sees every driver on the road on one map (refreshed every 15 seconds)
- Every admin is also a driver, so you can do deliveries yourself

**Limits to know:**

- Location is shared only while the portal is open on the driver's screen. If they lock the phone or switch to WhatsApp, the map pauses until they come back. Background tracking needs a native app.
- Addresses are turned into map points by OpenStreetMap's free service. A vague address may get no home marker or ETA; the driver map still works.
- Only the driver's latest position is stored, never a history. It's deleted when their last delivery is done, and swept daily.

## Owner how-to

A normal day is five quick checks: the 07:00 summary, EFT payments, drivers, reviews and stock.

**Daily routine**

- [ ] Read the 07:00 summary email; tap **Share today's summary** on the Dashboard to post it to the staff group
- [ ] Clear the Dashboard's EFT banner (below)
- [ ] Assign every confirmed or paid order to a driver and send the job on WhatsApp
- [ ] Publish or reject reviews waiting under Admin → Reviews
- [ ] Restock anything in the low-stock list

**Check an EFT payment**

1. Admin → Orders → **EFT to check**, open the order.
2. Tap **View proof of payment** if there is one.
3. In the FNB app, find a payment with the customer's **name and surname** and the order amount.
4. Enter the amount received and tap **Payment received**. If the money never arrives, cancel the order and its stock goes back.

**Assign a driver**

1. Admin → Orders, open the order.
2. Under **Driver**, pick the driver.
3. Under **WhatsApp**, tap **Send job to [driver]**, choose their chat and tap Send.
4. The order appears in their portal within 30 seconds. They tap Start delivery, then Delivered.

**Add a driver**

1. Admin → Drivers → **Add driver**: full name, phone, login email, password (8+ characters).
2. Send them the email, the password and the link 224clubhouse.store/driver.
3. To rename someone (including your own auto-created "admin" driver), add them again with the same email and the new name. Their password is left alone.
4. To remove access, tap **Disable**.

**Add product options**

1. Admin → Products → edit a product → **Options** → **Add option**.
2. Give each a name, price and stock; untick **On sale** to hide one.
3. While a product has options, its price and stock fields lock: they come from the options.

## Technical reference

Stack: React 19 + Vite SPA on Firebase Hosting, with Supabase for Postgres, Auth, Storage, Edge Functions, pg_cron and Vault. Supabase project ref `aogdkqczvlffgydgxsmz`. Production deploys from `master`.

**Database migrations (in order)**

| Migration | Adds |
| --- | --- |
| `20261005140000_product_variants` | `product_variants`, price/stock sync trigger, variant-aware `place_cod_order` and restock |
| `20261005150000_abandoned_cart_reminders` | `saved_carts`, opt-out prefs, claim/release RPCs, hourly + daily cron |
| `20261005160000_product_reviews` | `product_reviews`, delivered-purchase check, public read RPC |
| `20261007120000_eft_payment_verification` | Payment columns on `orders`, private `payment-proofs` bucket, `admin_set_eft_payment`, dispatch gate |
| `20261007130000_retire_orders_by_email` | Drops `get_orders_by_email` |
| `20261007140000_site_analytics` | `site_events`, `track_event`, admin `site_analytics`, 13-month purge |
| `20261007150000_driver_portal` | `drivers`, `driver_locations`, `orders.driver_id`, driver RPCs, `get_delivery_location` |
| `20261007160000_admins_are_drivers` | Driver row for every admin (trigger) |
| `20261008120000_age_verification` | `customer_profiles`, `set_date_of_birth`, age check in `place_cod_order` |
| `20261008130000_owner_alerts` | `daily_summary_data`, 07:00 cron |
| `20261008140000_delivery_eta` | Destination point, `distance_m`, nearby detection |
| `20261008150000_telegram_alerts` | `alert_settings`, Vault-stored bot token (dormant) |
| `20261008160000_admin_daily_summary` | Admin-only summary for the WhatsApp share |

**Edge Functions** (deploy with `--use-api`; cron-called ones also take `--no-verify-jwt`):

- **Emails and alerts:** `send-order-email`, `send-status-email`, `send-payment-email`, `send-review-alert`, `send-membership-application-alert`
- **Called by cron:** `send-cart-reminders` (hourly at :17), `send-daily-summary` (05:00 UTC = 07:00 SAST)
- **Admin / driver tools:** `admin-create-driver`, `geocode-order` (OpenStreetMap Nominatim), `telegram-connect`

**Secrets:** `RESEND_API_KEY`, `MAIL_FROM_DOMAIN` (`224clubhouse.store`), `ADMIN_ALERT_EMAIL` (`224clubhous@gmail.com`), `EFT_BANK_DETAILS`, `CRON_SECRET`. The Vault secret `cart_reminders_cron_secret` must equal `CRON_SECRET` and is shared by every cron call; rotate both together. Values are never stored in the repo.

**Tests:** 74 unit tests (`npx vitest run src/utils`) and about 190 live contract tests against the real database (`npm run test:contract`). They cover pricing, stock, row-level security, payments, drivers, analytics, age and alerts. A full combined run sometimes hits a known 90-second network freeze; re-run the failing file on its own.

**Deploy procedure**

1. Check accounts: `gh auth status` (tlaphane-1), `firebase login:list` (tlaphane@gmail.com), `supabase projects list` (224Clubhouse linked).
2. Dry-run new migrations: `begin;` + the file + `rollback;` via `supabase db query --linked -f`.
3. `supabase db push`, then run the live contract suites.
4. Deploy the changed Edge Functions.
5. `npm run build` (also writes the SEO pages), then `firebase deploy --only hosting --non-interactive`.
6. Open a PR and merge it to `master`.

## Open items and next steps

Nothing is broken. What's open is owner actions, one real-world test, and online payments waiting on a provider. The engineering version of this list lives in `OPEN_ITEMS.md` in the repo.

**Owner to-dos**

- [ ] Check FNB for the pending EFT orders and mark them paid or cancel them
- [ ] Do one real delivery with a phone: assign yourself, Start delivery, watch the map, Delivered
- [ ] Rename the auto-created "admin" driver profile to your real name (Admin → Drivers → Add driver, your own email)
- [ ] Add each driver's phone number so **Send job** works
- [ ] Delete or hide the `sss` test product (Google can see it)
- [ ] Supply a 1200×630 dark share image for better WhatsApp and Facebook previews
- [ ] Add a Gmail filter for `from:orders@224clubhouse.store` → never spam, mark important

**Recommended next builds**

1. **Dispatch board:** one screen with Ready to go → Assigned → On the road → Done today; cash collected per driver; a "Couldn't deliver" button with a reason.
2. **Online payments** (Paystack or Ozow), once a provider confirms it accepts the business. The server must keep recalculating totals itself.
3. **Cart-reminder setting** on the customer's Account page.
4. **Native driver app**, only if background tracking turns out to matter in practice.

Telegram alerts are built but switched off. Keep them dormant, or ask for them to be removed.
