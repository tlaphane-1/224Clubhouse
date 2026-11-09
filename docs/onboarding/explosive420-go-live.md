# Explosive 420 go-live: handoff (branch `feat/e420-go-live`, 2026-11-09)

Owner decisions: Explosive 420 has its **own Resend account** and its own
domain **explosive420.co.za** (bought 2026-11-09). 224 keeps its Resend
account (224clubhouse.store). No E420 email may go out through 224's key or
domain, and 224 must behave as before.

Nothing on this branch has been pushed or deployed.

## Commits

| Commit | What |
|---|---|
| `d6161e6` | admin-create-driver works in the caller's store; refuses another store's account |
| `4828537` | Migration `20261109120000_store_image_folders`: admins write/delete only their store's image folder |
| `1487998` | Migration `20261109130000_same_store_references`: child rows must share the parent's store; admin/driver rows must match the login's store |
| `2617fb0` | telegram-connect saves the bot and group for the caller's store |
| `0248d61` | `tenant.json` `mail` block, `scripts/build-function-stores.mjs` → `_shared/stores.generated.ts`, `_shared/mail.ts` (the one Resend sender) |
| `fda5e08` | Every email (receipts, status, EFT, membership, welcome, cart reminders, owner alerts, daily summary) branded and sent as the record's store |
| `c6679eb` | New `auth-send-email` (Send Email Hook) for sign-up / reset / magic link / email change / invite / reauth emails, per store. **Not enabled.** |

## Checks run (all in the worktree, against the LOCAL Supabase stack)

- `npm run lint`: clean.
- `npm run test:local` (whole vitest suite, both new migrations applied to the
  local DB): 46 files, 476 passed, 50 skipped (gate/describe skips), 0 failed.
- `npm run build` and `npm run build:e420`: both build (no `.env.local` in the
  worktree, so prerender skipped product/event pages).
- Not run: a Deno type check (no `deno` on this machine). Every function file
  is parse-checked as TypeScript by `functionStores.unit.test.js`, and the
  pure modules (`stores.ts`, `mail.ts`, `authEmail.ts`) are unit tested; the
  `serve()` handlers themselves have not been executed.

## Owner steps, in order

1. **Verify explosive420.co.za in the owner's Resend account** (the same
   account as 224; owner decision 2026-11-09). Added 2026-11-09 in region
   eu-west-1 with DKIM, two Forge CNAMEs and DMARC at domains.co.za.
2. **No new key.** Both stores use the existing `RESEND_API_KEY` secret. Check
   that key is not restricted to 224clubhouse.store only (Resend → API keys);
   if it is, E420 sends fail with a 403 until a full-access key replaces it.
   Do not deploy the functions before the domain shows Verified, or E420
   emails are refused by Resend.
3. **Check 224's `MAIL_FROM_DOMAIN` secret is set** (it is the domain 224
   sends from today; `supabase secrets list` shows the name). If it were
   unset, 224 now falls back to `224clubhouse.store` (the verified domain)
   instead of the old unverified `224clubhouse.co.za` default.
4. **Push the two migrations** (`supabase db push`): `20261109120000`,
   `20261109130000`. The second prints `same-store references: N existing
   row(s) disagree`; N should be 0 (it was 0 locally). It does not fail on N > 0.
5. **Deploy the functions** (`--use-api --project-ref aogdkqczvlffgydgxsmz`):
   - normal: `admin-create-driver`, `telegram-connect`, `geocode-order`, `send-order-email`,
     `send-status-email`, `send-payment-email`, `send-membership-email`,
     `send-welcome-email`, `send-membership-application-alert`, `send-review-alert`
   - with `--no-verify-jwt`: `send-cart-reminders`, `send-daily-summary`,
     `auth-send-email` (new). `supabase/config.toml` now also sets
     `verify_jwt = false` for these three, so a deploy that forgets the flag
     cannot lock out sign-ups.
6. **Deploy both sites** (`npm run build` + 224 deploy; `npm run build:e420` +
   E420 deploy). The only frontend change: the newsletter form tells
   `send-welcome-email` which store it is.
7. **Auth emails (optional, separate step).** Supabase Dashboard →
   Authentication → Hooks → Send Email → HTTPS, URL
   `https://aogdkqczvlffgydgxsmz.supabase.co/functions/v1/auth-send-email`,
   generate the secret and set it as the function secret
   `SEND_EMAIL_HOOK_SECRET`, then enable. Test: sign up one throwaway 224
   account and one E420 account; each confirmation must come from its own
   store's domain with its own branding.
   **Rollback:** disable the hook. Auth goes back to the project SMTP settings
   and `supabase/templates/` (left in place for this reason).

## Behaviour changes to know about

- The daily summary goes to the store's `alert_settings.alert_emails` when set,
  else (224 only) `ADMIN_ALERT_EMAIL`. 224's `alert_emails` is null today, so
  224's summary recipient is unchanged; setting it would redirect the summary too.
- `geocode-order` now also requires an admin to belong to the order's store.

- E420 emails show E420's name, logo, yellow, address and site; no social
  links (none set), no WELCOME10 block (E420's site does not offer it), and
  "free on orders of R500 or more" without the members line.
- Admin-triggered emails (status update, membership confirmation, payment
  received) now also require the admin to belong to the record's store.
- `send-cart-reminders` and `send-daily-summary` loop over every store and
  answer `{ stores: { <slug>: … } }` instead of one result. The daily summary
  goes to each store's own alert recipients (224: `ADMIN_ALERT_EMAIL`, as
  before; E420: tlaphane@gmail.com).
- Bank details on an EFT receipt: 224 keeps its `EFT_BANK_DETAILS` secret;
  if that were unset it now falls back to `tenant.json` instead of "details
  will follow". E420 has no bank details, so EFT stays off on its site.
- Auth emails, once the hook is on, come from `hello@<store domain>`. I could
  not see which sender address the current SMTP settings use for 224.
- `auth-send-email` answers 200 without sending for action types the project
  does not use (OTP `email`, the `*_notification` types).

## Not verified / open

- No real email was sent from any new code path (no Resend key in the
  worktree, by design).
- E420's `domain.siteUrl` is still `https://explosive420.web.app`. If the site
  moves to explosive420.co.za, change `tenants/explosive420/tenant.json`, re-run
  `node scripts/build-function-stores.mjs`, and add the URL to Auth redirect URLs.
- Production may hold rows the new triggers would refuse (step 4 reports the
  count); only the local DB was checked.
- storage.objects has no UPDATE policy for product/event images, so upserts
  stay refused for every admin, as before.
