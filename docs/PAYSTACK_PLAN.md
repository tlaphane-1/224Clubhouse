# Paystack online payments: investigation and plan

Status: research and plan only, nothing built. Written 2026-10-02.
Supersedes the payment half of `tasks/todo.md` Workstream 2. That plan was written before
`place_cod_order` existed, and it creates the order only *after* payment.

---

## 0. Verdict: NO-GO until a processor approves the business in writing

**The blocker is acceptability, not engineering.** Every mainstream South African gateway we
checked either prohibits cannabis outright or excludes it by its general wording:

| Provider | Policy found | Source |
|---|---|---|
| **Paystack** | Prohibits "Banned narcotics, steroids, certain controlled substances…" and "Illegal drugs and drug paraphernalia". The list does not name cannabis. For South Africa it also bars "products on South Africa's customs prohibition list". Paystack is a Stripe company, and Stripe's own list prohibits "cannabis products, cannabis dispensaries and related businesses". | https://support.paystack.com/en/articles/2127042 · https://stripe.com/legal/restricted-businesses |
| **Yoco** | Explicit: *"Cannabis is also not legal to sell in South Africa and is therefore a prohibited business type."* CBD is also excluded. | https://support.yoco.help/en/articles/109569-prohibited-businesses-at-yoco |
| **Peach Payments** | Explicit: *"Transactions related to cannabis products and dispensaries are not permitted."* CBD is restricted and needs written approval. | https://www.peachpayments.com/scale/high-risk-industries/ |
| **PayFast** (Network Intl) | Prohibits "controlled substances or herbs and botanicals", medicines, and anything it deems "undesirable" for reputational reasons. | https://payfast.io/legal/general-terms-conditions/ |
| **Ozow** (pay-by-bank EFT) | No public list found. Ozow sits under the same PASA/SARB/bank rules, so assume the same answer until Ozow confirms in writing. | https://ozow.com/ |

**Legal context.** The Cannabis for Private Purposes Act covers private use and cultivation. It
does not legalise **commercial sale**. Commercial regulations were still pending in 2026
(e.g. https://mayet.law/south-africas-cannabis-and-hemp-laws-in-2026-a-compliance-guide-for-business/).
The site sells `flower`, `edibles` and `joints` for delivery, and a processor's underwriting
will read that as a cannabis dispensary.

**What this means in practice:**
1. **Ask Paystack in writing before writing any code.** Describe the business exactly as it is:
   a private members' cannabis club selling flower, edibles and joints to members for delivery.
   Paystack's own page says to contact them if unsure. An honest "no" costs nothing. A "yes"
   gained by describing the business as something else ends in a frozen balance and a
   terminated account, usually after money has already been taken from customers.
2. **Do not route product sales through "membership" or "merchandise" labels to get approved.**
   That is misrepresentation under every one of the terms above, and it is the most common way
   such accounts get shut down with funds held.
3. **A possible narrow yes: memberships and genuine non-cannabis merchandise only**, on a
   separate approval, with cannabis products staying cash/EFT. Only pursue this if Paystack
   agrees to it in writing with full knowledge of the business.
4. **The fallback is the status quo, and it works.** Cash/card on delivery plus EFT (already
   allowed by `orders_payment_method_check`) need no processor. The only gap is manual
   reconciliation of EFT payments.
5. **Related risk outside this plan.** "Card on delivery" depends on someone's card machine.
   If that machine is a Yoco terminal, Yoco's terms already prohibit this business. The owner
   should check which provider the delivery card machine belongs to.

Fees, for the record (not confirmed first-hand; paystack.com returned HTTP 403 to automated
fetches): local cards **2.9% + R1**, international **3.1% + R1**, R1 waived under R10,
EFT/Capitec Pay 2%. All excl. VAT. Settlement T+1 to T+2 business days; international ~7.
Sources: https://paystack.com/za/pricing (403 to fetch), https://www.qwabi.co.za/blog/paystack-fees-south-africa-2026,
https://rebill.co.za/blog/how-paystack-works-south-africa/. Note that the **R10 daily membership**
would lose about R1.29 + VAT (~15%) per payment.

---

## 1. A hazard in the code today

`src/pages/Membership.jsx` switches to online payment when `VITE_PAYSTACK_PUBLIC_KEY` is
present (`PAY_ONLINE`). That path is **client-trusted**:
- The browser sets the amount.
- The browser invents the reference.
- `place_membership(p_customer, p_tier, p_reference)` stores the reference without checking
  it with Paystack.

So anyone could submit a made-up reference and get a "paid" application. The amount stored is
server-priced, but nothing confirms that money moved. `src/components/checkout/PaystackButton.jsx`
has the same client-side pattern.
**Do not set `VITE_PAYSTACK_PUBLIC_KEY` in any deployed environment until Phase 2 below ships.**
Phase 2 should replace both client paths, not re-enable them.

---

## 2. Architecture (if approved)

Principle: **the server creates the order, sets the amount, and decides it was paid.** The
browser only opens the Paystack popup for a transaction the server already initialised.

```
Checkout (signed in)
  └─► Edge Fn  paystack-init          (caller JWT)
        1. rpc place_online_order(...)  -> order row, status 'awaiting_payment',
                                           stock + discount reserved, total from DB prices
        2. POST api.paystack.co/transaction/initialize
              { email: account email, amount: order.total (cents), currency: 'ZAR',
                reference: order.payment_reference, callback_url, metadata.order_id }
        3. return { access_code, reference }
  └─► browser: new PaystackPop().resumeTransaction(access_code)   (InlineJS v2, stays on-site)
  └─► on popup success -> Edge Fn paystack-verify {reference}  (fast path for the UI)
Paystack ──► Edge Fn paystack-webhook  (no JWT; durability path if the tab is closed)
        1. HMAC-SHA512(raw body, PAYSTACK_SECRET_KEY) == x-paystack-signature  (constant-time)
        2. only handle event 'charge.success'
        3. GET /transaction/verify/:reference  (never trust the webhook body alone)
        4. rpc mark_order_paid(reference, amount, currency, paystack_id)  (service role)
        5. return 200 quickly
```

APIs used (docs: https://paystack.com/docs/api/transaction/, https://paystack.com/docs/payments/webhooks/,
https://paystack.com/docs/developer-tools/inlinejs/):
- `POST /transaction/initialize` takes `email` and `amount` in **subunits (cents)**, which
  matches our integer-cents storage, plus `reference` and `callback_url`. It returns
  `authorization_url`, `access_code` and `reference`.
- `GET /transaction/verify/:reference` returns `data.status === 'success'`, `data.amount`
  and `data.currency`.
- Webhooks: header `x-paystack-signature` is an HMAC SHA512 of the raw body keyed with the
  secret key. Sender IPs are `52.31.139.75`, `52.49.173.169` and `52.214.14.220`, the same for
  test and live. Paystack retries every 3 min ×4, then hourly for 72 h in live mode. Respond 200.
- **Popup vs redirect:** use the InlineJS v2 popup (`resumeTransaction(access_code)`). It keeps
  the age-gated site in view and reuses the existing `CustomerAuth` session. Set
  `callback_url` anyway as the fallback for browsers that block the popup.

### Rules `mark_order_paid` must enforce (all in SQL, one transaction)
- `select … for update` the order by `payment_reference`. Unknown reference → raise.
- **Idempotent:** if the order is already `paid` with that reference, return OK and do nothing.
  Webhook, verify call and retries will all race to this point.
- `verified amount = orders.total` **and** `currency = 'ZAR'`. If not, set status
  `payment_mismatch`, alert the admin, do not fulfil, and refund by hand.
- If the order already **expired** (stock released) when payment lands: re-reserve stock if it
  is still available, otherwise flag `paid_needs_refund`. Never silently drop a paid order.
- Stamp `paid_at` and `paystack_transaction_id`, append to `status_history`, then fire
  `send-order-email`.

### Stock reservation and release
- `place_online_order` decrements stock and consumes the discount redemption up front, exactly
  like `place_cod_order` does. This prevents overselling while the customer is in the popup.
- Unpaid orders expire after ~30 min. There is no cron today
  (`membership_effective_status` computes expiry on read), so choose one:
  - **(a)** enable `pg_cron` and run `expire_unpaid_orders()` every 5 min. It cancels
    `awaiting_payment` orders older than 30 min, restocks them using the logic already written
    in `20260814101000_restock_on_cancel.sql`, and gives back `discount_codes.times_redeemed`.
  - **(b)** run the same sweep lazily at the start of `place_online_order`.
  - Recommended: (a), with (b) as a safety net.
- Before cancelling, the sweep should call Paystack verify for each order it is about to
  expire. That catches payments whose webhook was missed.
- **Membership gate:** the "membership required after first order" check in `place_cod_order`
  must ignore `awaiting_payment` and expired orders. Otherwise an abandoned card attempt would
  count as a "previous order".

---

## 3. Database changes (one migration)

`orders`:
- `payment_reference text unique` (server-generated, e.g. `224-<order_number>-<rand>`)
- `paystack_transaction_id bigint`
- `paid_at timestamptz`
- `payment_expires_at timestamptz`
- Status check: add `awaiting_payment`, `payment_mismatch`, `paid_needs_refund`.
  (`paid` already exists, from `20260622130000_cod_and_tracking.sql`.)
- `payment_method = 'online'` is already allowed.

`memberships`:
- Already has `paystack_reference`. Make it `unique` where not null.
- Add `payment_status text check in ('unpaid','awaiting_payment','paid')` and `paid_at`.
- Keep `status` meaning **admin approval**. Paid and approved are separate questions.
- The index `memberships_one_pending_per_user` would block a retry after an abandoned payment.
  Either let the sweep cancel expired unpaid applications, or have `place_membership` reuse
  the caller's own `awaiting_payment` row.

New functions:
- `place_online_order(...)`
  - `SECURITY DEFINER`, `search_path` pinned.
  - Grant to `authenticated` only (same as `place_cod_order`).
  - Ideally refactor so both RPCs share one pricing and stock body, so delivery fee and
    discount logic cannot drift between them.
- `mark_order_paid(...)` and `mark_membership_paid(...)`
  - **Revoke from `public`, `anon` and `authenticated`.** Grant only to `service_role`.
    Only the Edge Functions call them.
- `expire_unpaid_orders()`: service_role and cron only.

RLS: no new client policies. Customers still read their own rows through `orders_owner_select`.
`awaiting_payment` rows show up in `/orders`; the UI should label them "Awaiting payment" and
offer a "Resume payment" button that calls `paystack-init` again for the same order.
`get_order_tracking` should expose the new statuses. The admin dashboard revenue tiles must
**exclude `awaiting_payment`, expired and mismatched orders.**

---

## 4. Memberships paid online

Same pattern, smaller:
1. `paystack-init` with `{kind:'membership', tier}` calls `place_membership`.
   - The row is `status 'pending'`, `payment_status 'awaiting_payment'`.
   - The amount is `membership_tiers.price_cents`, read server-side.
2. Paystack is initialised with that amount.
3. The webhook calls `mark_membership_paid`, which:
   - sets `payment_status 'paid'`;
   - fires `send-membership-application-alert`;
   - leaves the admin approval step as it is today. Approval still starts the clock, and admins
     can now see "paid" before approving.

Refund policy for rejected applications must be decided (manual refund in the Paystack dashboard).

---

## 5. Secrets

| Name | Where | Notes |
|---|---|---|
| `PAYSTACK_SECRET_KEY` | `supabase secrets set` (Edge Functions only) | `sk_test_…` first, then `sk_live_…`. Never in `src/`, never `VITE_`. |
| `VITE_PAYSTACK_PUBLIC_KEY` | `.env.local` / Firebase build env | `pk_test_…` / `pk_live_…`. Public by design. Set it only after Phase 2 (see §1). |
| Webhook URL | Paystack dashboard → Settings → API Keys & Webhooks | `https://<project>.supabase.co/functions/v1/paystack-webhook` |

Deploy `paystack-webhook` with `--no-verify-jwt`, because Paystack sends no Supabase JWT. Its
security comes from the signature, the IP allowlist and the verify call. `paystack-init` and
`paystack-verify` keep JWT verification and use `callerClient`. Follow the existing
`_shared/cors.ts` / `supabaseClients.ts` pattern; the webhook needs no CORS.

---

## 6. Testing (matches `src/__tests__/*.contract.test.js`)

- **`payments.contract.test.js`** (live DB, run-tagged fixtures, auto-skip without keys, as in
  `cod.contract.test.js`):
  - **Negative:** anon and authenticated users cannot execute `mark_order_paid`,
    `mark_membership_paid` or `expire_unpaid_orders`.
  - **Positive:** `place_online_order` returns `awaiting_payment`, the server total, and
    decremented stock. The client `total`/`price` is ignored.
  - **Positive (service role):**
    - `mark_order_paid` with the correct amount gives `paid`.
    - Calling it again is a no-op (idempotent).
    - The wrong amount gives `payment_mismatch`.
  - **Positive:** `expire_unpaid_orders` cancels a back-dated order, restores stock and gives
    back the discount redemption. A paid order is never expired.
  - **Negative:** an `awaiting_payment` order does not trip the membership-required gate.
- **Webhook unit test** (vitest, pure function):
  - A signature-check helper extracted to `_shared/paystackSignature.ts`.
  - A valid HMAC passes. A tampered body, a wrong key or a missing header fails.
- **Paystack test mode end to end:**
  - Use Paystack's published test cards (https://paystack.com/docs/payments/test-payments/).
    `4084 0840 8408 4081` / CVV `408` is the long-standing one; confirm it works for ZAR.
  - Check a successful payment, a failed card, and closing the popup (order expires, stock
    returns).
  - Replay a webhook from the dashboard; it must stay idempotent.
- Add the new spec to `test:contract` and `predeploy` in `package.json`, and add the
  new RPCs to `migrationGate.unit.test.js` if it enumerates them.

---

## 7. Phased steps (rough effort; begins only after written approval)

| Phase | Work | Effort |
|---|---|---|
| 0 | Owner gets written acceptance from Paystack (or another provider) for the exact business. **Stop here on a no.** | owner, 1–3 weeks |
| 1 | Migration: columns, statuses, `place_online_order`, `mark_*_paid`, sweep + pg_cron, membership-gate fix, grants. Contract tests. | 1.5–2 days |
| 2 | Edge Functions `paystack-init`, `paystack-verify`, `paystack-webhook`, shared signature helper and unit test. Remove the client-trusted Paystack paths in `Membership.jsx` / `PaystackButton.jsx`. | 1.5 days |
| 3 | Frontend: "Pay online" option in Checkout, InlineJS v2 popup, awaiting-payment state on `/orders` and the confirmation page, "Resume payment", admin badges and revenue-tile exclusion. UI changes go through the designer skill and ui-reviewer per CLAUDE.md. | 1.5–2 days |
| 4 | Memberships online (init + webhook branch, admin "paid" badge). | 0.5–1 day |
| 5 | Test-mode end to end, then switch to live keys and do one real low-value purchase plus a refund. | 0.5 day + owner |

Total engineering is about **5–7 days** after approval. Deploy the DB migration and the
frontend together (lesson from 2026-08-08), and run the account check in CLAUDE.md before
deploying.

---

## 8. What the owner needs to do (plain English)

1. **Ask Paystack first, honestly.** Email Paystack support (or use the chat on paystack.com)
   before signing up. Say that 224 Clubhouse is a private members' cannabis club in Boksburg
   that sells cannabis flower, edibles and joints to members for delivery, and wants to take
   card payments online. Ask whether they will accept the business, and get the answer **in
   writing**. If they say no, stop: we stay on cash, card on delivery and EFT. If they say
   "memberships only", tell us. That is a smaller project.
2. **Check the card machine.** Find out which company supplies the card machine used for
   "card on delivery". Their rules may also forbid this business.
3. **If Paystack says yes, open the account** at https://dashboard.paystack.com/#/signup and
   choose South Africa. You will need:
   - the company's CIPC registration certificate and number;
   - ID for at least one director;
   - a **bank confirmation letter** for a business account in the company's exact registered
     name, less than 6 months old;
   - proof of address.
4. **Send us the two TEST keys** from Settings → API Keys & Webhooks: the public one starts
   with `pk_test_` and the secret one starts with `sk_test_`. Send the secret key only through
   a private channel. We will put it straight into Supabase and never in the website code.
5. When testing has passed, **send the two LIVE keys** the same way. Then make one small real
   purchase and refund it to confirm money reaches the bank account (usually the next business
   day).
6. **Decide two policies:**
   - What happens to the money if a paid membership application is rejected? (Refund in
     full, refunded by hand from the Paystack dashboard.)
   - Is online payment worth it for the R10 daily membership, where fees take about 15%?
