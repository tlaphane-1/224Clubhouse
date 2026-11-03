# Explosive 420 Cannabis Social Club: owner inputs

Supplied by the owner on 2026-10-29. Feeds `tenants/explosive420/tenant.json` in
phase 5 (see `docs/superpowers/specs/2026-10-24-multi-tenant-design.md` §9).

## Supplied

- **Name:** Explosive 420 Cannabis Social Club
- **Address:** 702 Aubrey Matlakala St, Soshanguve Block L, Soshanguve, 0152
  (province assumed Gauteng)
- **Minimum age:** 21 (owner decision 2026-11-03; the supplied text said 18).
- **Phone:** 076 135 2497 (+27 76 135 2497)
- **Hours:** Monday – Sunday, 09:00 – 22:00
- **Bank:** Capitec, 076 135 2497 (holder name, account type and whether this
  is the account number or a pay-to-cellphone number still to confirm)
- **Logo:** the single image supplied earlier (see spec §9). No wide logo or
  square icon; drafts to be made from it for owner approval.
- **Domain:** none yet.
- **First admin:** the owner gave tlaphane@gmail.com. If that address already
  has a 224 account, it cannot also be an Explosive 420 account, because one
  shared Auth project allows one account per email. Proposed:
  `tlaphane+explosive420@gmail.com` (same Gmail inbox, separate account).

## About text, as supplied

The supplied text was a web-search summary with citation markers and links to
unrelated sites. The citations are removed below. The text is kept otherwise
as the source for the About page copy, which is to be rewritten for owner
approval.

> Explosive 420 Cannabis Social Club is an active premium indoor strain vendor
> and private wellness lifestyle circle located in Soshanguve Block L, South
> Africa. The club focuses on connecting quality flower from local indigenous
> growers to adult members looking for an alternative health and social
> routine.
>
> **Core offerings and vibe**
> - Flower & concentrates: premium indoor strains starting around R150 per
>   gram, alongside dabs and extracts.
> - Philosophy: a community-driven lifestyle approach where premium cannabis
>   aligns with general physical and mental wellness.
> - Legalities: operates under South African private adult-use guidelines.
>   Access is strictly reserved for vetted adult members (18+).
>
> **Practical guidance for visiting**
> 1. Age restriction: 18 or older with a valid South African ID or passport to
>    enter or sign up.
> 2. Private membership: members register at the venue door before accessing
>    the menu or space.
> 3. Consumption policy: a safe, judgment-free wellness atmosphere designed for
>    mindful consumption.

## Gaps and conflicts found

1. **Minimum age is 18, but 21 is fixed throughout the app.** It appears in the
   age gate, signup, checkout, the membership forms and the server-side RPC
   checks. It needs a per-store `minimumAge` setting, both in `tenant.json`
   and in the database (phase 2).
2. **No domain** blocks the store's own email sender (signup confirmations,
   receipts) and its web address. The site could run on `explosive420.web.app`
   first, but customer signup cannot go live until emails come from the
   store's own domain.
3. **"Register at the venue door"** conflicts with the site's online
   membership signup. Owner to confirm how members join.
4. **Still missing:** contact email, legal name, POPIA information officer,
   Instagram/Facebook links, a header photo, gallery photos, testimonials,
   house rules, and whether the store delivers (224's site is delivery-only).
