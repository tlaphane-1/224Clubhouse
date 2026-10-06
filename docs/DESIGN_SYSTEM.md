# 224 Clubhouse — Design System

This file is the authoritative UI reference for the site (see `CLAUDE.md`). It records what the codebase **already uses**. It is not a new system. The sources of truth are `tailwind.config.js`, `src/index.css`, and `src/components/ui/`. Counts in brackets are grep hits across `src/` as of 2026-10-02. They show what is an established convention and what is a one-off.

If you need something this file doesn't cover, add it to `tailwind.config.js` or `src/index.css` first and document it here. Don't hardcode it in a component.

**2026-10-03 — "Warm lounge" refresh.** Added the `leaf` accent, glow shadows, `aspect-portrait`, chips, the hero aura, skeleton shimmer and scroll reveal, and made the storefront (Home, Store, product card, product page, navbar) mobile-first. Those additions are marked **(new)** below.

---

## 1. Principles

- **Dark and premium.** Every page sits on near-black `background`, with content on `surface` panels that have a 1px `border`. There is no light mode.
- **Use gold sparingly.** Use `gold` for primary actions, eyebrow labels, prices, active states and focus. Don't use it for body text or large fills. Translucent gold (`bg-gold/10`, `border-gold/20`) marks highlighted panels.
- **Serif headings, sans body.** Headings use Playfair Display and running text uses Inter.
- **Mobile-first.** Most customers shop on a phone. Write the base classes for phones, then add `sm:` / `md:` / `lg:` / `xl:` overrides. The navbar collapses to a slide-in drawer below `md`. **(new)** Rules for every storefront change:
  - **Tap targets are at least 44×44px** (`h-11` / `w-11`). Icon-only controls get a 44px box even when the icon is 16–24px. Inline text links inside a sentence are the only exception.
  - **The primary action is reachable without scrolling.** On the product page it lives in a sticky bottom bar on phones (see §7).
  - **No horizontal page scroll** at 360px or 390px wide. Swipeable rows scroll *inside* their own container (`overflow-x-auto`).
  - **Hover is a desktop enhancement only.** `tailwind.config.js` sets `future.hoverOnlyWhenSupported`, so `hover:` styles never fire on touch. Give touch feedback with `active:` (`active:scale-95` on buttons and tiles, `active:scale-[0.98]` on cards). Never hide a control behind hover.
  - **Form text is 16px on phones.** A global rule in `index.css` forces this below `sm`, because iOS zooms the page into any smaller field. Don't fight it.
  - **Check with the phone screenshots** (390×844 and 360×740) before calling UI done.
- **Accessibility basics that are in place today:**
  - `.input-base` shows a gold focus border and ring.
  - `PaymentMethodSelect.jsx` uses `focus-visible:ring-2 focus-visible:ring-gold` and `role="radiogroup"`.
  - Icon-only buttons have `aria-label` [16], for example Footer social links, the AdminLayout menu, and the EventDetail quantity steppers.
  - The custom `animate-*` classes, `.reveal`, `.skeleton` and the leaf glow are switched off under `prefers-reduced-motion` (see `index.css`). Tailwind's `animate-spin` is not, deliberately, because a loading spinner should keep spinning. Decorative built-ins must use `motion-safe:` (e.g. the hero scroll indicator's `motion-safe:animate-pulse`).
  - Product and brand images have `alt` text.
  - New icon-only controls **must** have an `aria-label`. New custom interactive elements **must** have a visible `focus-visible` ring: add the `.focus-ring` class **(new)** (gold ring for keyboard focus, nothing for mouse/touch).
  - **Never nest interactive elements** (a button inside a link). Put the action beside the link and position it over the card (see the product card pattern in §7).
  - Links inside running text need a **permanent underline** (`underline underline-offset-2`). Colour alone isn't enough, and `hover:underline` never shows on phones.

---

## 2. Color tokens

Defined in `tailwind.config.js` → `theme.extend.colors`.

| Token | Hex | Classes | Use |
|---|---|---|---|
| `background` | `#0a0a0a` | `bg-background` [41] | Page background (also set on `body` in `index.css`), image wells, AgeGate |
| `surface` | `#111111` | `bg-surface` [88] | Cards, panels, modals, drawers, inputs |
| `gold` | `#C9A84C` | `text-gold` [244], `bg-gold`, `border-gold`, `ring-gold` | Primary CTA, eyebrows, prices, active nav, focus |
| `gold-light` | `#e2c074` | `hover:bg-gold-light`, `hover:text-gold-light` [21] | Hover state of gold elements only |
| `muted` | `#888888` | `text-muted` [382], `placeholder-muted` | Secondary text, labels, captions, inactive icons |
| `border` | `#222222` | `border-border` [161], `bg-border` | All 1px borders, dividers (`h-px bg-border`), skeleton blocks |
| `leaf` **(new)** | `#7CC242` | `text-leaf`, `bg-leaf/10`, `border-leaf/30`, `shadow-glow-leaf` | Botanical accent from the letterhead. **Accent only:** chip/tile hover icons, the free-delivery pill, member-benefit icons and links. Never a CTA background and never long text. Gold stays the action colour. |
| `leaf-deep` **(new)** | `#1B2E12` | (inside `.hero-aura`) | Dark green used only in background gradients. |
| *(Tailwind)* `white` / `black` | — | `text-white`, `text-black` | Primary text is white. Text on a gold button is black. |

**Opacity modifiers in use:** `bg-gold/10`, `bg-gold/20`, `border-gold/20`, `border-gold/40` [~60 combined], `text-gold/20`, `text-gold/30` (the "224" placeholder watermark), `bg-muted/10`, `shadow-gold/10`, `shadow-gold/30`. Overlays use `bg-black/60` (drawers) and `bg-black/70` (modals) with `backdrop-blur-sm`.

### Semantic colors (Tailwind palette, not tokens)

| Meaning | Classes | Where |
|---|---|---|
| Error / destructive | `text-red-400` [46]; panel `bg-red-500/10 border-red-500/20`; invalid input `border-red-500 focus:ring-red-500`; `bg-red-600` (Button `danger`) | Field errors, error states, cancelled status |
| Success | `text-green-400` [25]; pill `bg-green-500/10 text-green-400 border-green-500/20` | Delivered/paid, confirmations |
| Info | `text-blue-400`, `bg-blue-500/10 border-blue-500/20` | Confirmed/processing status |
| Warning / in-progress | `text-yellow-400`, `bg-yellow-500/10 border-yellow-500/20` | Preparing status |

**Status pills:** the single map is `STATUS_BADGE` in `src/utils/orderStatus.js`. `Badge.jsx` mirrors it. Reuse one of these, and don't write a new per-page map.

**Category / strain badges** live only in `Badge.jsx`: flower=green, edibles=orange, joints=emerald, accessories=blue, merchandise=yellow, indica=purple, sativa=yellow, hybrid=teal, members=gold. Every one follows `bg-{c}-900/50 text-{c}-400|300 border-{c}-800`.

### Rule: no raw hex in components

Use the tokens above. Known exceptions that exist today:

- Toasts are styled in one place, `src/utils/toastTheme.js`, which **reads the colours from `tailwind.config.js`**. The only literal left is `#fff` for toast text. (The old per-page toast styles and `accent-[#C9A84C]` are gone, and `index.css` now uses `theme()` instead of hex.)
- Box-shadow and gradient colours are defined once in `tailwind.config.js` (`shadow-glow`) and `index.css` (`.hero-aura`, `.skeleton`) via `theme()`. Use the classes, not new rgba values.
- **Email HTML** (`supabase/functions/*`, `supabase/templates/*`) is exempt, because email clients need inline hex. See §10.
- **Printable invoice sheet** (`src/pages/Invoice.jsx`) uses `bg-white text-black` and Tailwind `neutral-*` greys, on screen and on paper, because it is printed / saved as PDF. The toolbar around it stays on brand tokens. Print CSS is the small `@media print` block at the end of `index.css`.

---

## 3. Typography

| Family | Class | Font | Applied |
|---|---|---|---|
| Heading | `font-heading` [87] | Playfair Display (Google Fonts, 400–900 + italics) | All `h1`–`h6` get it from base CSS. Add the class explicitly on non-heading elements. |
| Body | *(default)* | Inter 300–700 | Set on `body`. `font-body` exists in config but is unused, because the default already applies. |
| Mono | `font-mono` | system | Order numbers (`font-mono text-gold`) |

### Heading scale actually used

| Role | Classes | Reference |
|---|---|---|
| Hero display | `font-heading text-5xl md:text-6xl font-bold` (up to `text-7xl`) | `Home.jsx`, `About.jsx` |
| Listing page h1 | `font-heading text-4xl md:text-5xl font-bold text-white`. **(new)** The Store uses `text-3xl sm:text-4xl md:text-5xl` so the header doesn't push the products below the fold on a phone. | `Store.jsx`, `Events.jsx` |
| Narrow page h1 (account/order pages) | `font-heading text-3xl md:text-4xl font-bold text-white` | `MyOrders.jsx`, `TrackOrder.jsx` |
| Admin page h1 | `font-heading text-3xl font-bold text-white` | `pages/admin/*` |
| Section heading | `.section-heading text-white` (**2xl** on phones **(new)** → sm:3xl → md:4xl, bold, uppercase, `tracking-wider`) | `Home.jsx`, `About.jsx` |
| Panel / card title | `font-heading text-2xl font-bold` [21] or `text-xl font-semibold` | `Modal.jsx` title, cards |
| Small block heading | `text-white font-semibold text-sm uppercase tracking-widest` [34] | `MyOrders.jsx`, `CheckoutForm.jsx` |

### Body and labels

- Body text is `text-sm` [273] for UI and form text. Use the default size or `text-lg` for intro/lead copy with `leading-relaxed`.
- Captions and meta use `text-xs text-muted` [257].
- **Eyebrow** (gold kicker above an h1): `text-gold text-xs uppercase tracking-[0.4em]` [17]. `tracking-widest` [17] and `tracking-[0.3em]` [5] variants also exist. Use `tracking-[0.4em]` for new page eyebrows.
- **Form / field label:** `block text-muted text-xs uppercase tracking-widest mb-1.5` [37 for `text-muted text-xs uppercase tracking-widest`].
- **Uppercase CTA text:** add `text-xs uppercase tracking-widest` to `.btn-gold` / `.btn-outline` (`MyOrders.jsx`).

---

## 4. Spacing and layout

| Thing | Convention | Reference |
|---|---|---|
| Page wrapper | `min-h-screen pt-28 pb-20 animate-fadeIn` [pt-28: 19, pb-20: 16]. `pt-28` clears the fixed navbar. Hero/marketing sections use `pt-32`. **(new)** Store and product pages use `pt-24 md:pt-28` because the navbar is shorter on phones. | `Store.jsx`, `Events.jsx` |
| Navbar **(new)** | `h-16 md:h-20`, fixed, `z-50`. Anything pinned below it uses `top-16 md:top-20`. | `Navbar.jsx` |
| Wide container | `max-w-7xl mx-auto px-4 sm:px-6 lg:px-8` (store, events, product, navbar, footer) | `Store.jsx` |
| Cart / checkout container | `max-w-6xl mx-auto px-4 sm:px-6 lg:px-8` | `Cart.jsx`, `Checkout.jsx` |
| Narrow container | `max-w-2xl mx-auto px-4` (account, orders, tracking, confirmation) | `MyOrders.jsx` |
| Form-only page | `max-w-md mx-auto px-4` | `ResetPassword.jsx` |
| Prose / legal | `max-w-3xl mx-auto` | `legal/LegalPage.jsx` |
| Page header spacing | header block `mb-10`–`mb-14`; eyebrow `mb-2`/`mb-3` | |
| Marketing sections | `py-20` / `py-24`, `px-4`. **(new)** On Home they are `py-14 md:py-24` (phones get less dead scroll). | `Home.jsx`, `About.jsx` |
| Card padding | `p-6` [54] default; `p-4` [55] compact rows and list items; `p-8` [23] for empty/error/feature panels; `p-5` for payment options and event card bodies. **(new)** Product card bodies are `p-3 sm:p-4` (half-width on phones). | |
| Stacks | `space-y-4` / `space-y-5` (forms), `space-y-2` (lists) | `CheckoutForm.jsx` |
| Grid gaps | `gap-6` for card grids, `gap-4` [53] for form rows, `gap-2`/`gap-3` for inline icon + text, `gap-12` for two-column page layouts | |
| Product grid **(new)** | `grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-6`. Two columns on phones, so a screen shows four products instead of one. | `ProductGrid.jsx` |
| Swipe row **(new)** | `flex gap-3 overflow-x-auto scrollbar-hide snap-x snap-mandatory scroll-px-4 px-4`, children `snap-start flex-shrink-0 w-40`. Switch to a grid at `lg:` (`lg:grid lg:grid-cols-5 lg:overflow-visible`). | Home category tiles, `CategoryFilter.jsx` |
| Event grid | `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6` | `Events.jsx` |

**Breakpoints:** Tailwind defaults only (`sm` 640, `md` 768, `lg` 1024, `xl` 1280). `md` is the main switch, used for the navbar drawer and for 2-col forms.

**Z-index layers:**

| Layer | z-index |
|---|---|
| Navbar | `z-50` |
| Admin mobile header | `z-30` |
| Drawer overlay | `z-[60]` |
| Drawer | `z-[70]` |
| Modal | `z-[80]` |
| AgeGate | `z-[9999]` |

---

## 5. Radii, borders, shadows

| Radius | Count | Use |
|---|---|---|
| `rounded-full` | 50 | Pills/badges, spinners, avatars, icon buttons |
| `rounded-xl` | 52 | Product/event cards, list rows, payment options, `Card.jsx` |
| `rounded-2xl` | 43 | Page-level panels, empty/error states, `Modal.jsx` |
| `rounded-lg` | 36 | Buttons and inputs (via `.btn-*` / `.input-base`), small icon buttons |
| `rounded` | 14 | Skeleton bars only |

Don't use `rounded-md`, `rounded-sm` or `rounded-3xl`. None of them are used anywhere.

- **Borders:** always 1px, either `border border-border` or a semantic tint (`border-gold/20`, `border-red-500/20`). Highlighted or hovered borders use `border-gold`.
- **Shadows:** rare. Use `hover:shadow-lg hover:shadow-gold/10` (cards) or `hover:shadow-gold/30` (gold button), and `shadow-2xl` only on modals. Resting elements have no shadow. **(new)** `shadow-glow` (gold) and `shadow-glow-leaf` are the warm glows: use them on hover (product cards, category tiles), on the active chip, and on the product-page photo. Nowhere else.
- **Aspect ratios (new):** product photos in cards are `aspect-portrait` (4:5). The product-page main photo stays `aspect-square`.

---

## 6. Components

### `@layer components` classes (`src/index.css`)

| Class | Use | Usage |
|---|---|---|
| `.btn-gold` | Primary action, one per view | 54 |
| `.btn-outline` | Secondary action (sign out, back, alternate CTA) | 20 |
| `.input-base` | Every text input, select and textarea | 39 |
| `.section-heading` | Uppercase serif h2 that opens a marketing section | 9 |
| `.card-hover` | Hover lift for clickable cards (used only through `Card hover`) | 1 |
| `.text-gold-gradient` | Gold gradient text. It is defined but **currently unused**. | 0 |
| `.chip` + `.chip-active` / `.chip-idle` **(new)** | 44px pill filter button with a focus ring. Pair with `aria-pressed`. | `CategoryFilter.jsx` |
| `.hero-aura` **(new)** | Soft gold + leaf radial light. Place on an `absolute inset-0` layer behind content; add `animate-drift` for slow movement. | Home hero, membership band, product photo |
| `.skeleton` **(new)** | Loading block with a gold shimmer (replaces `bg-border animate-pulse`). | `ProductGrid.jsx`, `ProductDetail.jsx` |
| `.reveal` **(new)** | Fades a section up as it scrolls into view (CSS scroll-driven, no JS). | Home sections, product grid items |
| `.focus-ring` **(new)** | Gold `focus-visible` ring (with background offset) for any custom control. `.chip` already includes it. | Cards, tiles, icon buttons, steppers |
| `.scrollbar-hide` **(new)** | Hides the scrollbar on swipe rows (utility layer). | Swipe rows |

```jsx
<button className="btn-gold">Place Order</button>
<Link to="/store" className="btn-outline px-4 py-2 text-xs uppercase tracking-widest">Sign Out</Link>
<input className="input-base text-sm" placeholder="you@email.com" />
<h2 className="section-heading text-white">The Collection</h2>
```

`.btn-gold` handles `disabled:` itself. `.btn-outline` does not, so add `disabled:opacity-50` when an outline button can be disabled.

### `src/components/ui/`

| Component | Props | Notes |
|---|---|---|
| `Button.jsx` | `variant`: `gold` (default) \| `outline` \| `ghost` \| `danger`, plus native props | Used in admin forms. `gold` and `outline` match `.btn-*`. `danger` = `bg-red-600`. |
| `Badge.jsx` | `variant` = category, strain, `members`, or order status | `rounded-full text-xs uppercase tracking-wide`. Unknown variants fall back to `bg-surface text-muted`. |
| `Card.jsx` | `hover` bool, `className` | `bg-surface border border-border rounded-xl`. It is **not imported anywhere** right now, because pages write the same classes inline. Prefer it for new cards. |
| `Modal.jsx` | `isOpen`, `onClose`, `title`, `size`: `sm`\|`md`\|`lg`\|`xl`, **(new)** `sheet`, `footer` | Locks body scroll; closes on backdrop click and **Escape**; `role="dialog"` labelled by its title. `sheet` = full-screen on phones, centred from `sm:` (use for any form). `footer` = actions pinned under the scrolling body so Submit is always visible. |
| `StickyActionBar.jsx` **(new)** | `hideFrom`: `md` \| `lg`, `className` | The phone primary-action bar (§7). |
| `Checkbox.jsx` **(new)** | `id`, `checked`, `onChange(bool)`, `invalid` | A real `<input type="checkbox">` (sr-only) with the gold box; the whole label row is the tap target. Never build a checkbox from a `div`. |

```jsx
<Badge variant="delivered">Delivered</Badge>
<Button variant="danger" onClick={onDelete}>Delete</Button>
<Modal isOpen={open} onClose={() => setOpen(false)} title="Edit Product" size="lg">…</Modal>
```

---

## 7. Patterns (reference files)

**Page header.** Reference: `src/pages/Store.jsx`.
```jsx
<div className="mb-12 animate-fadeIn">
  <p className="text-gold text-xs uppercase tracking-[0.4em] mb-2">Shop</p>
  <h1 className="font-heading text-4xl md:text-5xl font-bold text-white mb-2">The Store</h1>
  <p className="text-muted">Members' Selection</p>
</div>
```

**Panel / card.** Use `bg-surface border border-border rounded-2xl p-6` for page panels and `rounded-xl` for repeated items. An image placeholder is the "224" watermark: `font-heading text-4xl font-bold text-gold/30`.

**Product card (new).** Reference: `src/components/store/ProductCard.jsx`.
- The wrapper is `group relative h-full active:scale-[0.98]`, so pressing anywhere gives feedback.
- The `<Link>` is the card itself (`focus-ring … hover:border-gold hover:shadow-glow`), with `aria-label="Name, R price"`.
- The add/join action is a **sibling** of the link, `absolute bottom-3 right-3`: a 44px round icon button on phones, icon + label from `sm:`. The link's price row reserves room for it with `pr-12 sm:pr-24`.
- Badges over the photo stack top-left (`flex flex-col items-start gap-1`), each on a `rounded-full bg-black/70` backing so they read on light photos. No `backdrop-blur`; it costs a GPU layer per card.

**Forms.** Reference: `src/components/checkout/CheckoutForm.jsx`.
```jsx
<label className="block text-muted text-xs uppercase tracking-widest mb-1.5">Full Name *</label>
<input className={`input-base text-sm ${err ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : ''}`} />
{err && <p className="text-red-400 text-xs mt-1">{err}</p>}
```
Helper text uses `text-muted text-xs mt-1`. Locked fields add `opacity-60 cursor-not-allowed` and `disabled`.

**Loading.** There are two kinds:
- Spinner [16 identical uses]: `<div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />`. Centre it in `flex justify-center py-12`, or use full-screen `min-h-screen flex items-center justify-center`. Inline spinners use `w-5 h-5` or `w-6 h-6`.
- Skeletons for lists and pages: `.skeleton` blocks shaped like the content they replace (photo, title, price), inside the normal card/panel frame. References: `ProductGrid.jsx` `SkeletonCard`, and the `ProductDetail.jsx` loading state. Older pages still use `bg-border animate-pulse`; new code uses `.skeleton`.

**Empty state.** Reference: `src/pages/MyOrders.jsx`.
```jsx
<div className="bg-surface border border-border rounded-2xl p-8 text-center">
  <Package size={28} className="text-muted mx-auto mb-3" />
  <p className="text-white text-sm mb-1">No orders yet</p>
  <p className="text-muted text-xs mb-6">When you place an order, it will show up here.</p>
  <Link to="/store" className="btn-gold px-6 py-3 text-xs uppercase tracking-widest">Browse the Store</Link>
</div>
```
Full-page empty (`Cart.jsx`) uses a `size={56} strokeWidth={1}` lucide icon, a `font-heading text-2xl` title, and `.btn-gold`.

**Error state.** Reference: `src/pages/Store.jsx`. Use `bg-surface border border-red-500/20 rounded-2xl p-8 text-center max-w-md mx-auto`, an `AlertTriangle size={28} className="text-red-400"`, a `text-white text-sm` message, and a Retry `.btn-gold text-sm`. Inline alerts inside a page use `bg-red-500/10 border border-red-500/20 rounded-2xl p-6 flex items-start gap-3` (`OrderDetail.jsx`).

**Toasts.** These use `react-hot-toast`. `<Toaster>` in `App.jsx` gets `toastOptions={TOAST_OPTIONS}` from `src/utils/toastTheme.js`, so every `toast.success()` / `toast.error()` is branded automatically: don't pass a `style`. For the rare gold-edged confirmation, pass `style: HIGHLIGHT_TOAST_STYLE` (newsletter and contact form).

**Sticky action bar (new).** Use `components/ui/StickyActionBar.jsx` for a page's primary action on phones: product page (Add to Cart, `hideFrom="md"`), cart (Total + Checkout, `hideFrom="lg"`), checkout (Place Order, `hideFrom="lg"`) and membership (Apply, `hideFrom="md"`). It renders `sticky bottom-0 z-30 px-4 pt-3 pb-4 bg-background/95 backdrop-blur-md border-t border-border`. It is a direct child of the (untransformed) page wrapper, placed **right after the product details and before "You Might Also Like"**. That keeps it in the right reading and focus order: it pins to the bottom while the product is on screen, then settles above the related products. The same control renders inline inside a `hidden md:block` wrapper for larger screens, so only one copy is ever visible or in the accessibility tree. Reference: `src/pages/ProductDetail.jsx`.

**Collapsible order summary (new).** On phones, checkout shows a `min-h-14` total bar ("Show order summary (2 items) ▾ R160", `aria-expanded`) that opens the full summary and the discount field. From `lg:` the summary is a normal sticky sidebar. One render, toggled with `hidden … lg:block`. Reference: `src/pages/Checkout.jsx`.

**Choose-one cards (new).** For picking one option (membership tiers): real radio inputs (`peer sr-only`) inside `<label>`s, in a `<fieldset>` with an sr-only `<legend>`. Phones get compact rows (icon, name, duration, price, radio dot); `md:` gets full cards with perks. The chosen option's details sit under the list on phones. Selected = `border-gold shadow-glow bg-gold/5`. Reference: `src/pages/Membership.jsx`.

**Validation on phones (new).** When a submit fails, call `focusField(id)` (`src/utils/focusField.js`) on the first invalid field, in on-screen order. It scrolls the field to the middle of the screen and focuses it; on a phone the error is otherwise hidden above the button. Error text is linked with `aria-describedby` and fields carry `aria-invalid`. Reference: `CheckoutForm.jsx` + `Checkout.jsx`.

**Fold long secondary content on phones (new).** Long reference lists (the 12 Commandments) collapse behind a full-width `h-12` toggle (`aria-expanded`, `aria-controls`) below `md:` and show normally above it.

**Sticky filter bar (new).** Store category chips sit in `sticky top-16 md:top-20 z-30 bg-background/90 backdrop-blur-md border-b border-border`, right under the navbar. Reference: `src/pages/Store.jsx`.

**Modals.** Use `ui/Modal.jsx` (`Checkout.jsx`, `pages/admin/*`). Drawers follow `Navbar.jsx`: a `bg-black/60 backdrop-blur-sm animate-fade` overlay, then `bg-surface border-l border-border animate-slideInRight`.

**Icons.** `lucide-react` only. Sizes are 14–16 inline, 20–24 for controls, 28 for state panels, and 56 for full-page empties.

---

## 8. Motion

All of these are defined in `src/index.css` and disabled under `prefers-reduced-motion`.

| Class | Effect | Use |
|---|---|---|
| `animate-fadeIn` [40] | fade + rise 20px, 0.3s | Page wrappers, headers, state panels |
| `animate-fade` [8] | opacity only, 0.3s | Overlays and backdrops, AgeGate |
| `animate-scaleIn` [9] | scale 0.95→1 + rise, 0.2s | Modal panels, popovers |
| `animate-slideInRight` [1] | slide from right, 0.3s | Mobile nav drawer |
| `animate-spin` / `animate-pulse` | Tailwind built-ins | Spinners / skeletons |
| `animate-drift` **(new)** | the layer slowly translates (scaled to 1.2 so edges never show), 18s, alternating | `.hero-aura` layers inside an `overflow-hidden` parent |
| `animate-glow-leaf` **(new)** | a static `shadow-glow-leaf` on a pseudo-element whose opacity breathes, 3s | The single "free delivery for members" pill (a statically positioned element; the class adds `position: relative`). Keep it to one element per screen. |
| `.reveal` **(new)** | rise + fade as the element scrolls into view | Section headers, cards, panels |
| `.skeleton` **(new)** | a gold sheen pseudo-element sliding across, 1.6s | Loading placeholders |

Transitions use `transition-colors` or `transition-all duration-200` for controls and `duration-300` for cards. Press feedback on buttons is `active:scale-95` (`active:scale-90` on round icon buttons, `active:scale-[0.98]` on whole cards). Card hover is `hover:border-gold hover:shadow-glow`.

**Motion rules (new):**
- **Continuous animations animate only `transform` and `opacity`.** Those are composited by the GPU. `background-position`, `box-shadow`, `filter` and colour animations repaint every frame. Measured on the hero at 4× CPU throttle, the first version of the drift and glow (background-position and box-shadow) cost 720 paints and ~1.5s of raster work per 3 idle seconds; the transform/opacity rewrite costs 0. To pulse a shadow, put a static shadow on a pseudo-element and animate its opacity (`.animate-glow-leaf`).
- `.reveal` needs no JavaScript and fails safe. Browsers without scroll-driven animations, and anyone with reduced motion on, just see the content.
- **Never put `.reveal` (or any transform) on an element that contains a `sticky` or `fixed` child.** Wrap the child instead (`ProductGrid.jsx` puts `.reveal` on a wrapper div, not on the card).
- Every new keyframe must be listed in the `prefers-reduced-motion` block in `index.css`.

---

## 9. Reviewer checklist

**Do**
- [ ] Use colors only from §2 tokens or the listed semantic palette.
- [ ] Use `.btn-gold` / `.btn-outline` / `ui/Button` for buttons and `.input-base` for inputs.
- [ ] Give each page the `pt-28 pb-20` wrapper, one of the §4 containers, and the eyebrow + h1 header.
- [ ] Handle loading (spinner or skeleton), empty and error states with the §7 markup.
- [ ] Use `rounded-xl` / `rounded-2xl` / `rounded-lg` / `rounded-full` according to §5.
- [ ] Give icon-only buttons an `aria-label` and custom controls a `focus-visible:ring-gold`.
- [ ] Use `STATUS_BADGE` / `Badge` for status colors.
- [ ] Check that layout works at 360px and 390px wide before adding `sm:`+ overrides, with no horizontal page scroll.
- [ ] Make every tap target at least 44×44px, including icon-only buttons, chips, steppers and the cart icon.
- [ ] Make sure the page's primary action is visible on a phone without scrolling, or sits in a sticky bar.
- [ ] Use `leaf` only as an accent (icons, the delivery pill, member links), never as a button fill.
- [ ] Give form fields a `<label htmlFor>`, the right mobile keyboard (`type="tel"`, `inputMode="numeric"`, `type="email"`), an `autoComplete` hint, and jump to the first error on submit.
- [ ] Use `ui/Modal` with `sheet` for forms, and `ui/StickyActionBar` for a page's primary action on phones.
- [ ] Don't add render-blocking third-party scripts to `index.html`. Load them on demand where they're used (e.g. Paystack in `Membership.jsx`).

**Don't**
- [ ] Don't use hex literals, `[#...]` arbitrary colors, or `text-gray-*` / `bg-zinc-*`. None are used today, so keep it that way.
- [ ] Don't use new arbitrary sizes (`text-[11px]`, `w-[123px]`) when a scale value fits.
- [ ] Don't put more than one gold primary CTA in a view, or use gold for long body text.
- [ ] Don't use `rounded-md` / `rounded-sm` / `rounded-3xl`, or add shadows on resting elements.
- [ ] Don't add new keyframes without a reduced-motion override.
- [ ] Don't build a hand-rolled modal. Use `ui/Modal`.

---

## 10. Email templates

Transactional emails mirror the brand with **inline styles**. They are exempt from the no-hex rule.

- **Sources:** `supabase/functions/send-*/index.ts` (order, status, welcome, membership, membership alert) and `supabase/templates/*.html` (Supabase Auth confirmation, recovery, magic link, invite, email change, reauthentication).

| Element | Inline value |
|---|---|
| Page background | `#0a0a0a` |
| Card | `#111111` with `1px solid #222222` and `border-radius:12px` |
| Gold | `#C9A84C` for CTAs (black text, uppercase, `letter-spacing:2px`, `border-radius:8px`) and links |
| Text | White headings, `#cccccc` body, `#888888` meta, `#444444` fine print |
| Headings | `font-family:Georgia, serif`. Email clients can't load Playfair, so Georgia stands in. |
| Body font | Arial/Helvetica (some functions try `'Inter',Arial,sans-serif`) |
| Layout | `max-width:560px` (some functions use `600px`) centred column, logo from the `brand-assets` bucket, address + "Not for persons under 21" footer |

When changing an email, keep it consistent with `supabase/templates/confirmation.html`.
