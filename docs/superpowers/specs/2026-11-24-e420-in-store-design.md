# Explosive 420 in-store system — design

Date: 2026-11-24 · Status: draft, awaiting owner approval
Source: owner feedback 2026-11-24 (two handwritten pages), agreed order and choices in chat.

## Intent

The club wants one shared tablet at the counter that the cashier on shift uses to ring up sales,
scan stock, and see how the store is doing live, and that customers can also use at the table as
a menu and ordering screen. Staff clock in with a selfie. Customers are reminded what they bought
before. Everything runs inside the existing E420 site (same database, same products and stock),
so online collect orders and counter sales share one stock count and one sales report.

Built for Explosive 420 first, behind a per-store switch (`features.inStore` in `tenant.json`),
so 224 Clubhouse is unchanged unless switched on later.

## Non-goals / decided against

- **No face recognition.** Owner agreed 2026-11-24 to use a membership QR code instead (face data
  is "special personal information" under POPIA; leak risk at a cannabis club).
- No card-machine integration: the cashier records "cash" or "card" by hand.
- No offline mode: the tablet needs Wi-Fi/data (a sale fails loudly rather than silently queueing).
- No AI. "AI customer memory" = the customer's last 10 orders with dates, read from the database.
- No payroll: shifts record clock-in/out and a selfie, nothing about pay.

## Constraints

- Money in integer cents; stock changes only through server functions that lock rows (same rules
  as `place_cod_order`).
- POPIA: staff selfies and customer phone numbers are personal information. Selfies go in a
  private bucket, are visible to admins only, and are deleted after 90 days.
- Phone/tablet first: 44 px taps, works in Chrome on Android and Safari on iPad.
- UI follows `docs/DESIGN_SYSTEM.md` tokens.

## Who can do what (new role)

A new **staff** role (table `staff_members`: user, store, display name, active). Staff can use
the cashier screen, stock-take and clock in. Only admins can change prices, products, staff and
see selfies. The shared tablet signs in as a **staff** account, never as an admin, so a customer
using it at the table cannot reach admin pages. Admins manage staff in Admin → Staff.

## Part 1 — Cashier tablet (`/counter`)

**Product codes.** Admin → Products gets "Print QR labels": a printable sheet with one QR per
product (and per option, e.g. 3.5 g) showing name and price. The QR holds the product/option id.

**Ringing up a sale.**
1. Customer: scan their membership QR (from their phone), or search by name/phone, or "walk-in"
   (name + number typed). Shows: member or not (and tier/expiry), and their **last 10 orders with
   dates and items** (the "memory").
2. Items: scan product QRs with the tablet camera, or tap from a product grid; adjust quantity.
   Price and stock come from the database.
3. Payment: cash or card. Tap "Complete sale".
4. Server function `record_counter_sale` checks stock, decrements it, and saves the sale as an
   order (`channel = 'counter'`, status collected, paid, staff member recorded). Same age and
   member-only rules as online.

**Stock-take.** Scan a product (or pick it), type the counted quantity, save. Each change is kept
in `stock_adjustments` (who, when, old → new, reason) so missing stock is visible.

**Live dashboard.** The cashier screen's "Today" tab and Admin → Dashboard show today's sales,
counter vs online, top strains, low stock — updating live (Supabase Realtime) without refresh.
The existing Reports page gains a counter/online split.

## Part 2 — Shift clock-in (`/counter` → "Start shift")

Staff tap "Start shift", take a selfie with the front camera, confirm. The server records the time
(the device clock is not trusted) and stores the photo privately. "End shift" records the end time.
Admin → Shifts lists shifts per day with selfie thumbnails and hours. A sale can only be rung up by
someone on an open shift, so every sale is tied to a person.

## Part 3 — Table menu, ordering and ratings (`/table`)

The same tablet, switched to **table mode** by staff (exit needs the staff PIN). Customers:
- browse the menu (strains, prices, what's in stock);
- identify with their membership QR (or phone number + a 4-digit PIN they set on their account);
- see their last 10 orders and "order again";
- place an order → it appears on the counter screen as "table order" for the cashier to confirm,
  take payment and hand over (same `record_counter_sale` path);
- rate products they've had (1–5 stars + optional comment), feeding the existing reviews.

Membership QR: shown on the customer's account page on their phone (a signed code, not just the
member id, so it can't be guessed or forged).

## New libraries (need your OK)

- `qrcode` — draws the QR codes (labels, membership card).
- `@zxing/browser` — reads QR codes with the camera on iPad Safari, which lacks the built-in
  scanner Chrome has.

## Build order (each part ships and is tested on its own)

1. Staff role + Admin → Staff + Shift clock-in (Part 2) — everything else needs a signed-in staff
   member on shift.
2. Cashier tablet: QR labels, ringing up sales, customer memory, stock-take, live dashboard (Part 1).
3. Membership QR + table menu, ordering and ratings (Part 3).

Each part: database migration with live contract tests (including "a customer cannot do this"
checks), screens checked on a tablet-sized preview before going live, deployed only with your OK.

## Left to decide while building (Claude's calls unless you say otherwise)

Exact screen layouts (shown to you as previews before go-live), label sheet size (A4, 3×8 grid),
selfie retention (90 days), whether table orders expire if unconfirmed (30 minutes).
