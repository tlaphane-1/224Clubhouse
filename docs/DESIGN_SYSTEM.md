# 224 Clubhouse — Design System

This file is the authoritative UI reference for the site (see `CLAUDE.md`). It records what the codebase **already uses**. It is not a new system. The sources of truth are `tailwind.config.js`, `src/index.css`, and `src/components/ui/`. Counts in brackets are grep hits across `src/` as of 2026-10-02. They show what is an established convention and what is a one-off.

If you need something this file doesn't cover, add it to `tailwind.config.js` or `src/index.css` first and document it here. Don't hardcode it in a component.

---

## 1. Principles

- **Dark and premium.** Every page sits on near-black `background`, with content on `surface` panels that have a 1px `border`. There is no light mode.
- **Use gold sparingly.** Use `gold` for primary actions, eyebrow labels, prices, active states and focus. Don't use it for body text or large fills. Translucent gold (`bg-gold/10`, `border-gold/20`) marks highlighted panels.
- **Serif headings, sans body.** Headings use Playfair Display and running text uses Inter.
- **Mobile-first.** Write the base classes for phones, then add `sm:` / `md:` / `lg:` / `xl:` overrides. The navbar collapses to a slide-in drawer below `md`.
- **Accessibility basics that are in place today:**
  - `.input-base` shows a gold focus border and ring.
  - `PaymentMethodSelect.jsx` uses `focus-visible:ring-2 focus-visible:ring-gold` and `role="radiogroup"`.
  - Icon-only buttons have `aria-label` [16], for example Footer social links, the AdminLayout menu, and the EventDetail quantity steppers.
  - All `animate-*` utilities are switched off under `prefers-reduced-motion`.
  - Product and brand images have `alt` text.
  - New icon-only controls **must** have an `aria-label`. New custom interactive elements **must** have a visible `focus-visible` ring.

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

- `src/utils/cartToast.js` and toast `style` objects in `Home.jsx`, `Contact.jsx` and `Login.jsx` use `#111111`, `#222222`, `#C9A84C`, `#fff` and `#000`. react-hot-toast takes inline style objects, so these are acceptable but should mirror the tokens exactly.
- `src/pages/Membership.jsx` uses `accent-[#C9A84C]` on a checkbox. It should be `accent-gold`.
- `src/index.css` `@layer base` hardcodes `#0a0a0a`, `#ffffff`, `#111111`, `#333333` and `#C9A84C` for `body` and the scrollbar.
- **Email HTML** (`supabase/functions/*`, `supabase/templates/*`) is exempt, because email clients need inline hex. See §10.

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
| Listing page h1 | `font-heading text-4xl md:text-5xl font-bold text-white` | `Store.jsx`, `Events.jsx` |
| Narrow page h1 (account/order pages) | `font-heading text-3xl md:text-4xl font-bold text-white` | `MyOrders.jsx`, `TrackOrder.jsx` |
| Admin page h1 | `font-heading text-3xl font-bold text-white` | `pages/admin/*` |
| Section heading | `.section-heading text-white` (3xl→md:4xl, bold, uppercase, `tracking-wider`) | `Home.jsx`, `About.jsx` |
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
| Page wrapper | `min-h-screen pt-28 pb-20 animate-fadeIn` [pt-28: 19, pb-20: 16]. `pt-28` clears the fixed navbar. Hero/marketing sections use `pt-32`. | `Store.jsx`, `Events.jsx` |
| Wide container | `max-w-7xl mx-auto px-4 sm:px-6 lg:px-8` (store, events, product, navbar, footer) | `Store.jsx` |
| Cart / checkout container | `max-w-6xl mx-auto px-4 sm:px-6 lg:px-8` | `Cart.jsx`, `Checkout.jsx` |
| Narrow container | `max-w-2xl mx-auto px-4` (account, orders, tracking, confirmation) | `MyOrders.jsx` |
| Form-only page | `max-w-md mx-auto px-4` | `ResetPassword.jsx` |
| Prose / legal | `max-w-3xl mx-auto` | `legal/LegalPage.jsx` |
| Page header spacing | header block `mb-10`–`mb-14`; eyebrow `mb-2`/`mb-3` | |
| Marketing sections | `py-20` / `py-24`, `px-4` | `Home.jsx`, `About.jsx` |
| Card padding | `p-6` [54] default; `p-4` [55] compact rows and list items; `p-8` [23] for empty/error/feature panels; `p-5` for payment options and event card bodies | |
| Stacks | `space-y-4` / `space-y-5` (forms), `space-y-2` (lists) | `CheckoutForm.jsx` |
| Grid gaps | `gap-6` for card grids, `gap-4` [53] for form rows, `gap-2`/`gap-3` for inline icon + text, `gap-12` for two-column page layouts | |
| Product grid | `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6` | `ProductGrid.jsx` |
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
- **Shadows:** rare. Use `hover:shadow-lg hover:shadow-gold/10` (cards) or `hover:shadow-gold/30` (gold button), and `shadow-2xl` only on modals. Resting elements have no shadow.

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
| `Modal.jsx` | `isOpen`, `onClose`, `title`, `size`: `sm`\|`md`\|`lg`\|`xl` | Locks body scroll and closes on backdrop click. The header and body each have `p-6`. |

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

**Panel / card.** Use `bg-surface border border-border rounded-2xl p-6` for page panels and `rounded-xl` for repeated items. Clickable cards use the `group` pattern in `src/components/store/ProductCard.jsx`: `group-hover:border-gold group-hover:shadow-lg group-hover:shadow-gold/10`, with the image at `group-hover:scale-105`. An image placeholder is the "224" watermark: `font-heading text-4xl font-bold text-gold/30`.

**Forms.** Reference: `src/components/checkout/CheckoutForm.jsx`.
```jsx
<label className="block text-muted text-xs uppercase tracking-widest mb-1.5">Full Name *</label>
<input className={`input-base text-sm ${err ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : ''}`} />
{err && <p className="text-red-400 text-xs mt-1">{err}</p>}
```
Helper text uses `text-muted text-xs mt-1`. Locked fields add `opacity-60 cursor-not-allowed` and `disabled`.

**Loading.** There are two kinds:
- Spinner [16 identical uses]: `<div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />`. Centre it in `flex justify-center py-12`, or use full-screen `min-h-screen flex items-center justify-center`. Inline spinners use `w-5 h-5` or `w-6 h-6`.
- Skeleton grids for lists: `bg-surface border border-border rounded-xl animate-pulse` with `bg-border rounded` bars. Reference: `ProductGrid.jsx` `SkeletonCard`.

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

**Toasts.** These use `react-hot-toast` (`<Toaster position="top-right" />` in `App.jsx`). The branded style is `{ background: '#111111', color: '#fff', border: '1px solid #222222' }` with a gold icon theme. Reference: `src/utils/cartToast.js`. Reuse it rather than re-declaring it.

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

Transitions use `transition-colors` or `transition-all duration-200` for controls and `duration-300` for cards. Press feedback on buttons is `active:scale-95`. Card hover lift is `hover:scale-[1.02]`.

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
- [ ] Check that layout works at 375px wide before adding `sm:`+ overrides.

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
