# 224 Clubhouse — Supabase schema inventory (final state after all 30 migrations)

Source: `supabase/migrations/*.sql` read in filename order, plus `src/`, `supabase/functions/`, `scripts/`, `test/`, `src/__tests__/`. No remote DB was touched. File names below are shortened to their timestamp prefix, e.g. `20260604` = `20260604120000_admin_authorization.sql`. Full map:

| short | file |
|---|---|
| 0329a | 20260329172540_initial_schema.sql |
| 0329b | 20260329200000_memberships.sql |
| 0604 | 20260604120000_admin_authorization.sql |
| 0622 | 20260622130000_cod_and_tracking.sql |
| 0623 | 20260623120000_security_hardening.sql |
| 0806 | 20260806120000_orders_by_email.sql |
| 0808 | 20260808120000_customer_accounts_orders.sql |
| 0813 | 20260813150000_membership_accounts_tiers.sql |
| 0814a | 20260814100000_newsletter_unsubscribe.sql |
| 0814b | 20260814101000_restock_on_cancel.sql |
| 0814c | 20260814102000_event_reservations.sql |
| 0814d | 20260814103000_discount_codes.sql |
| 0814e | 20260814110000_discount_newsletter_fixes.sql |
| 1001a | 20261001120000_delivery_only_feedback.sql |
| 1001b | 20261001130000_address_rondebult_road.sql |
| 1005a | 20261005120000_delivery_only_tier_perks.sql |
| 1005b | 20261005130000_paper_membership_form.sql |
| 1005c | 20261005140000_product_variants.sql |
| 1005d | 20261005150000_abandoned_cart_reminders.sql |
| 1005e | 20261005160000_product_reviews.sql |
| 1007a | 20261007120000_eft_payment_verification.sql |
| 1007b | 20261007130000_retire_orders_by_email.sql |
| 1007c | 20261007140000_site_analytics.sql |
| 1007d | 20261007150000_driver_portal.sql |
| 1007e | 20261007160000_admins_are_drivers.sql |
| 1008a | 20261008120000_age_verification.sql |
| 1008b | 20261008130000_owner_alerts.sql |
| 1008c | 20261008140000_delivery_eta.sql |
| 1008d | 20261008150000_telegram_alerts.sql |
| 1008e | 20261008160000_admin_daily_summary.sql |

Counts: **19 tables** (public) · **52 policies** (42 public + 10 storage.objects) · **58 functions** (incl. 6 trigger fns, 6 capability probes; `get_orders_by_email` dropped) · **6 triggers** · **5 cron jobs** · 2 vault secrets · 3 migration-created buckets (+1 script-created).

---

## 1. Tables

**Check against the proposed tenant list:** all 19 names in the list exist exactly. No other table exists in `public` or any app schema. No views, no materialized views, no sequences except the identity on `site_events.id`. Non-public objects touched: `auth.users` (FKs + 1 trigger), `storage.buckets`/`storage.objects`, `vault.secrets`/`vault.decrypted_secrets`, `cron.job`.

RLS is **enabled on all 19**. "No policies" = RLS-on, RPC/service-role only.

### products — created 0329a:6 · RLS 0329a:68
| column | type | null | default |
|---|---|---|---|
| id | uuid | PK | gen_random_uuid() |
| name | text | NN | |
| description | text | | |
| price | integer | NN | (kept = min variant price by trigger when variants exist) |
| category | text | NN | check `products_category_check` in (flower,edibles,joints,accessories,merchandise) — 1001a:23-26 |
| stock_quantity | integer | NN | 0; check `products_stock_nonneg` >=0 (0623:34) |
| is_available | boolean | NN | true |
| is_member_only | boolean | NN | false |
| images | text[] | | '{}' |
| strain_type | text | | check in (indica,sativa,hybrid) |
| thc_percentage | numeric | | |
| weight_grams | numeric | | |
| slug | text | NN | **UNIQUE (global)** `products_slug_key` (0329a:19) |
| created_at | timestamptz | | now() |

### product_variants — 1005c:24 · RLS 1005c:41
id uuid PK gen_random_uuid(); product_id uuid NN FK→products(id) ON DELETE CASCADE; label text NN check len 1-60; price int NN >=0; stock_quantity int NN default 0 >=0; is_available bool NN true; sort_order int NN 0; created_at timestamptz NN now().
- UNIQUE (product_id, label) (auto-named `product_variants_product_id_label_key`) 1005c:33
- index product_variants_product_sort_idx (product_id, sort_order) 1005c:38

### product_reviews — 1005e:13 · RLS 1005e:36
id uuid PK; product_id uuid NN FK→products CASCADE; user_id uuid NN FK→auth.users CASCADE; rating smallint NN 1-5; body text NN default '' <=1000; display_name text NN len 1-40; status text NN default 'pending' check (pending,approved,rejected); created_at/updated_at timestamptz NN now(); moderated_at timestamptz.
- UNIQUE (product_id, user_id) 1005e:25 (used by `on conflict` in submit_product_review)
- idx product_reviews_product_status_idx, product_reviews_status_idx, product_reviews_user_id_idx (1005e:29-34)

### events — 0329a:41 · RLS 0329a:70
id uuid PK; title text NN; description text; date date NN; time text (free text); location text default **'224 Rondebult Road, Libradene, Boksburg'** (1001b:2); image_url text; is_members_only boolean default false (nullable); ticket_price integer; created_at timestamptz now(); capacity int check (null or >0) (0814c:33).
- No unique constraints besides PK.

### event_reservations — 0814c:37 · RLS 0814c:67
id uuid PK; event_id uuid NN FK→events CASCADE; user_id uuid FK→auth.users SET NULL; name text NN 1-200; email text NN 3-320; phone text NN 1-50; quantity int NN 1-10; status text NN default 'reserved' check (reserved,attended,cancelled); total_cents int NN 0 >=0; status_history jsonb NN '[]'; created_at timestamptz now().
- UNIQUE partial index event_reservations_one_active_per_user (event_id, user_id) WHERE status='reserved' AND user_id IS NOT NULL — 0814c:63
- idx event_reservations_event_id_idx, event_reservations_user_id_idx

### membership_tiers — 0813:33 · RLS 0813:45
id uuid PK; slug text NN **UNIQUE (global)** `membership_tiers_slug_key` check len 1-50; name text NN 1-100; price_cents int NN >=0; duration_days int NN >0; perks jsonb NN '[]'; is_active bool NN true; sort_order int NN 0; created_at timestamptz now().
- Seed rows daily/weekly/monthly 0813:60-82 (`on conflict (slug)`); prices updated by slug 1001a:14-16; perks by slug 1005a:11-33 (perk text "Join the 224 community" 1005a:15).

### memberships — 0329b:5 · RLS 0329b:22
| column | type | null | default / note |
|---|---|---|---|
| id | uuid | PK | gen_random_uuid() |
| full_name | text | NN | |
| email | text | NN | |
| phone | text | NN | |
| date_of_birth | date | NN | |
| id_number | text | | |
| tier | text | NN | legacy slug text; check dropped 0813:107 |
| status | text | NN | **default 'active'** (never changed) check (pending,active,expired,cancelled) |
| amount | integer | NN | |
| paystack_reference | text | | **UNIQUE (global)** `memberships_paystack_reference_key` |
| starts_at | timestamptz | | default dropped 0813:101 |
| expires_at | timestamptz | | |
| created_at | timestamptz | | now() |
| user_id | uuid | | FK auth.users SET NULL (0813:85) |
| tier_id | uuid | | FK membership_tiers(id), no ON DELETE (0813:86) |
| approved_at | timestamptz | | |
| status_history | jsonb | NN | '[]' |
| duration_days | int | | |
| residential_address, consumption_other, signature_image, signature_typed, approved_by, admin_notes | text | | 1005b:17-26 |
| consumption_reasons | text[] | | |
| consents | jsonb | | |
| signed_at | timestamptz | | |
- UNIQUE partial index memberships_one_pending_per_user (user_id) WHERE status='pending' AND user_id IS NOT NULL — 0813:112
- idx memberships_user_id_idx, memberships_tier_id_idx

### orders — 0329a:24 · RLS 0329a:69
| column | type | null | default / note |
|---|---|---|---|
| id | uuid | PK | |
| customer_name, customer_email, customer_phone | text | NN | |
| items | jsonb | NN | |
| subtotal, shipping_fee, total | integer | NN | |
| status | text | NN | 'pending'; check orders_status_check (pending,confirmed,preparing,out_for_delivery,paid,processing,shipped,delivered,cancelled) 0622:20 |
| paystack_reference | text | | **UNIQUE (global)** orders_paystack_reference_key |
| shipping_address | jsonb | NN | |
| created_at | timestamptz | | now() |
| payment_method | text | NN | 'online'; check (cash_on_delivery,card_on_delivery,eft,online) 1001a:19 |
| order_number | text | **nullable** | **UNIQUE index orders_order_number_key (global)** 0622:34 |
| tracking_token | uuid | NN | gen_random_uuid() (0622:15; unused by any function) |
| status_history | jsonb | NN | '[]' |
| user_id | uuid | | FK auth.users SET NULL (0808:19); idx orders_user_id_idx |
| discount_code | text | | (0814d:84) |
| discount_cents | integer | NN | 0 |
| paid_at | timestamptz | | 1007a:23 |
| paid_amount_cents | integer | | check >=0 |
| payment_confirmed_by | uuid | | FK auth.users SET NULL |
| payment_proof_path | text | | |
| payment_proof_uploaded_at | timestamptz | | |
| driver_id | uuid | | FK drivers(user_id) SET NULL (1007d:50) |
| delivery_started_at | timestamptz | | |
| dest_lat / dest_lng | double precision | | range checks (1008c:19-22) |
| geocoded_at, nearby_notified_at | timestamptz | | |
- idx orders_eft_unpaid_idx (created_at desc) WHERE payment_method='eft' AND paid_at IS NULL (1007a:32); orders_driver_id_idx partial (1007d:52)

### discount_codes — 0814d:34 · RLS 0814d:57
id uuid PK; code text NN **UNIQUE (global)** `discount_codes_code_key` check `^[A-Z0-9_-]{3,40}$`; description text <=300; kind text NN (percent,fixed); value int NN >0; constraint discount_codes_percent_range; min_subtotal_cents int NN 0; first_order_only bool NN false; max_redemptions int (>0 or null); times_redeemed int NN 0; starts_at, expires_at timestamptz; is_active bool NN true; created_at timestamptz now().
- Seed 'WELCOME10' 0814d:72-78 (`on conflict (code)`).

### newsletter_subscribers — 0329a:55 · RLS 0329a:71
id uuid PK; email text NN **UNIQUE (global)** `newsletter_subscribers_email_key` (lower(trim) enforced by trigger, not by an expression index); first_name, last_name text; subscribed_at timestamptz now(); discount_sent boolean default false; unsubscribe_token uuid NN default gen_random_uuid() + UNIQUE index newsletter_subscribers_unsubscribe_token_key (0814a:39); unsubscribed_at timestamptz.
- idx newsletter_subscribers_active_idx (subscribed_at desc) WHERE unsubscribed_at IS NULL.

### contact_messages — 0623:179 · RLS 0623:187
id uuid PK; name text NN <=200; email text NN <=320; subject text <=300; message text NN 1-5000; created_at timestamptz now().

### saved_carts — 1005d:23 · RLS 1005d:39
**user_id uuid PK** FK auth.users CASCADE; items jsonb NN '[]' check (array, <=50, <=32KB); updated_at timestamptz NN now(); reminded_at timestamptz. idx saved_carts_updated_at_idx.

### site_events — 1007c:17 · RLS 1007c:31 (no policies)
id **bigint generated always as identity** PK; created_at timestamptz NN now(); visitor_id uuid NN; session_id uuid NN; event text NN check (page_view,add_to_cart,checkout_start,order_placed); path text NN <=200; source text <=40; device text (mobile,tablet,desktop). idx site_events_created_at_idx, site_events_visitor_idx.

### customer_profiles — 1008a:15 · RLS 1008a:22
**user_id uuid PK** FK auth.users CASCADE; date_of_birth date NN; created_at, updated_at timestamptz NN now().

### customer_email_prefs — 1005d:85 · RLS 1005d:95 (no policies)
**user_id uuid PK** FK auth.users CASCADE; cart_reminders bool NN true; token uuid NN UNIQUE default gen_random_uuid() (`customer_email_prefs_token_key`); updated_at timestamptz NN now().

### drivers — 1007d:17 · RLS 1007d:25
**user_id uuid PK** FK auth.users CASCADE; full_name text NN len 1-80; phone text <=30; active bool NN true; created_at timestamptz NN now().

### driver_locations — 1007d:60 · RLS 1007d:70 (no policies)
**driver_id uuid PK** FK drivers(user_id) CASCADE; lat, lng double NN range-checked; accuracy_m, heading, speed_mps real; updated_at timestamptz NN now().

### admin_users — 0604:23 · RLS 0604:29
**id uuid PK** FK auth.users CASCADE; email text; created_at timestamptz now(). Seed by literal email `'admin@224clubhouse.co.za'` 0604:56-59.

### alert_settings — 1008d:15 · RLS 1008d:27 (no policies)
**id int PK default 1 CHECK (id = 1)** (singleton); telegram_chat_id bigint; telegram_chat_title text; telegram_enabled bool NN false; telegram_kinds jsonb NN '{}'; updated_at timestamptz NN now(). Seed row id=1 1008d:25.

### Per-user-PK tables (one row per auth user, regardless of store)
saved_carts, customer_profiles, customer_email_prefs, drivers, driver_locations (per driver), admin_users. A `tenant` column alone cannot give one user two rows — PK must become (user_id, tenant) or the table stays global.

### Global UNIQUE keys that a second store will collide on
products.slug · membership_tiers.slug · discount_codes.code · newsletter_subscribers.email · orders.order_number · orders.paystack_reference · memberships.paystack_reference · product_reviews (product_id,user_id) (fine — product is per-tenant) · product_variants (product_id,label) (fine).

---

## 2. Policies (final state)

Roles: "(public)" = no `TO` clause. All `is_admin()` calls are unscoped by tenant.

### public schema (42)
| table | policy | cmd | roles | USING | WITH CHECK | file:line |
|---|---|---|---|---|---|---|
| products | products_public_select | SELECT | public | `true` | | 0329a:73 |
| products | products_admin_insert | INSERT | public | | is_admin() | 0604:67 |
| products | products_admin_update | UPDATE | public | is_admin() | is_admin() | 0604:68 |
| products | products_admin_delete | DELETE | public | is_admin() | | 0604:69 |
| product_variants | product_variants_public_select | SELECT | public | `true` | | 1005c:46 |
| product_variants | product_variants_admin_insert | INSERT | public | | is_admin() | 1005c:49 |
| product_variants | product_variants_admin_update | UPDATE | public | is_admin() | is_admin() | 1005c:52 |
| product_variants | product_variants_admin_delete | DELETE | public | is_admin() | | 1005c:55 |
| product_reviews | product_reviews_owner_select | SELECT | public | (select auth.uid()) = user_id | | 1005e:41 |
| product_reviews | product_reviews_admin_select | SELECT | public | is_admin() | | 1005e:44 |
| product_reviews | product_reviews_admin_update | UPDATE | public | is_admin() | is_admin() | 1005e:47 |
| product_reviews | product_reviews_admin_delete | DELETE | public | is_admin() | | 1005e:50 |
| events | events_public_select | SELECT | public | `true` | | 0329a:80 |
| events | events_admin_insert | INSERT | public | | is_admin() | 0604:75 |
| events | events_admin_update | UPDATE | public | is_admin() | is_admin() | 0604:76 |
| events | events_admin_delete | DELETE | public | is_admin() | | 0604:77 |
| event_reservations | event_reservations_owner_select | SELECT | authenticated | user_id = auth.uid() | | 0814c:73 |
| event_reservations | event_reservations_admin_all | ALL | public | is_admin() | is_admin() | 0814c:79 |
| membership_tiers | membership_tiers_public_select | SELECT | public | `is_active` | | 0813:51 |
| membership_tiers | membership_tiers_admin_all | ALL | public | is_admin() | is_admin() | 0813:54 |
| memberships | memberships_admin_select | SELECT | public | is_admin() | | 0604:84 |
| memberships | memberships_admin_update | UPDATE | public | is_admin() | is_admin() | 0604:85 |
| memberships | memberships_admin_delete | DELETE | public | is_admin() | | 0604:86 |
| memberships | memberships_owner_select | SELECT | authenticated | user_id = auth.uid() | | 0813:119 |
| orders | orders_admin_select | SELECT | public | is_admin() | | 0623:22 |
| orders | orders_admin_update | UPDATE | public | is_admin() | is_admin() | 0623:23 |
| orders | orders_admin_delete | DELETE | public | is_admin() | | 0623:24 |
| orders | orders_owner_select | SELECT | authenticated | user_id = auth.uid() | | 0808:26 |
| orders | orders_driver_select | SELECT | public | driver_id = (select auth.uid()) and is_driver() | | 1007d:57 |
| discount_codes | discount_codes_admin_all | ALL | public | is_admin() | is_admin() | 0814d:66 |
| newsletter_subscribers | newsletter_public_insert | INSERT | public | | **`true`** | 0329a:85 |
| newsletter_subscribers | newsletter_admin_select | SELECT | public | is_admin() | | 0604:90 |
| contact_messages | contact_public_insert | INSERT | public | | **`true`** | 0623:190 |
| contact_messages | contact_admin_select | SELECT | public | is_admin() | | 0623:191 |
| saved_carts | saved_carts_owner_select | SELECT | public | (select auth.uid()) = user_id | | 1005d:42 |
| saved_carts | saved_carts_owner_insert | INSERT | public | | (select auth.uid()) = user_id | 1005d:45 |
| saved_carts | saved_carts_owner_update | UPDATE | public | (select auth.uid()) = user_id | same | 1005d:48 |
| saved_carts | saved_carts_owner_delete | DELETE | public | (select auth.uid()) = user_id | | 1005d:51 |
| customer_profiles | customer_profiles_owner_select | SELECT | public | (select auth.uid()) = user_id | | 1008a:25 |
| drivers | drivers_admin_all | ALL | public | is_admin() | is_admin() | 1007d:28 |
| drivers | drivers_self_select | SELECT | public | (select auth.uid()) = user_id | | 1007d:31 |
| admin_users | admin_users_self_select | SELECT | public | id = auth.uid() | | 0604:36 |

No policies (RPC / service-role only): site_events, customer_email_prefs, driver_locations, alert_settings.
No INSERT policy (RPC-only creation): orders, memberships, event_reservations, product_reviews, customer_profiles.

Dropped (not final): products_auth_* / events_auth_* (0604:64-74), memberships_auth_* (0604:81-83), memberships_public_insert (0623:29), newsletter_auth_select (0604:89), orders_auth_all (0623:18).

### storage.objects (10)
| policy | cmd | roles | bucket | expression | file:line |
|---|---|---|---|---|---|
| product_images_public_read | SELECT | public | product-images | bucket_id = 'product-images' | 0329a:109 |
| event_images_public_read | SELECT | public | event-images | bucket_id = 'event-images' | 0329a:118 |
| product_images_admin_upload | INSERT | public | product-images | check bucket & is_admin() | 0604:97 |
| product_images_admin_delete | DELETE | public | product-images | bucket & is_admin() | 0604:99 |
| event_images_admin_upload | INSERT | public | event-images | check bucket & is_admin() | 0604:104 |
| event_images_admin_delete | DELETE | public | event-images | bucket & is_admin() | 0604:106 |
| payment_proofs_owner_insert | INSERT | authenticated | payment-proofs | foldername[1] = auth.uid() AND exists(public.orders o where o.id::text = foldername[2] and o.user_id = auth.uid() and payment_method='eft' and status<>'cancelled' and paid_at is null) | 1007a:50 |
| payment_proofs_owner_select | SELECT | authenticated | payment-proofs | foldername[1] = auth.uid()::text | 1007a:66 |
| payment_proofs_admin_select | SELECT | authenticated | payment-proofs | public.is_admin() | 1007a:74 |
| payment_proofs_admin_delete | DELETE | authenticated | payment-proofs | public.is_admin() | 1007a:79 |

Buckets: product-images, event-images (public, 0329a:101-107); payment-proofs (private, 5MB, image/pdf, 1007a:37-45). `brand-assets` is created only by `scripts/setup-buckets.js:47` (no migration, no policies — public bucket, service-role uploads). Object paths are not store-prefixed (payment proofs: `<uid>/<order id>/<file>`).

---

## 3. Functions (final definitions)

Conventions: SD = SECURITY DEFINER. "sp" = `set search_path = public` (every function below has it). Grants are what the migrations state; **caveat:** Supabase's default privileges grant EXECUTE on new public functions to anon/authenticated/service_role, so a function with only `revoke … from public` (or no grant statement) is still executable by those roles unless they are revoked by name. All functions use `auth.uid()` for identity; none takes a tenant.

### Auth helpers
| fn | args → returns | SD | lang/vol | grants | final def | reads/writes |
|---|---|---|---|---|---|---|
| is_admin | () → boolean | SD | sql stable | none stated (default) | 0604:43 | R admin_users |
| is_driver | () → boolean | SD | sql stable | anon, authenticated (1007d:48) | 1007d:36 | R drivers (active) |

### Orders / checkout
| fn | args → returns | SD | grants | final def | reads / writes / notes |
|---|---|---|---|---|---|
| **place_cod_order** | (p_customer jsonb, p_items jsonb, p_payment_method text, p_discount_code text default null) → jsonb | SD plpgsql | revoke public, anon; grant authenticated (1008a:374-375) | **1008a:127** (prior defs 0622:40, 0623:37, 0808:34, 0813:449, 0814d:242 [3-arg dropped 0814d:240], 0814e:232, 1001a:30, 1005c:110) | R auth.users, customer_profiles, orders, memberships, products (FOR UPDATE), product_variants (FOR UPDATE), discount_codes (via discount_eval). W orders (insert), products/product_variants (stock), discount_codes.times_redeemed. Advisory lock `pg_advisory_xact_lock(hashtextextended(v_uid::text,0))` 1008a:167. **21:** `interval '21 years'` 1008a:178, msg 'Age check: …' 1008a:180. **'224-'** order number 1008a:305, uniqueness check global 1008a:306. Shipping literals 50000 / 3000 1008a:301. Payment whitelist 1008a:183. No `on conflict`. |
| get_order_tracking | (p_order_number text, p_email text) → jsonb | SD sql stable | anon, authenticated (1007a:215) | 1007a:186 (prior 0622:116, 0814e:432) | R orders (by order_number + lower(email)) |
| admin_update_order_status | (p_order_id uuid, p_status text) → jsonb | SD | revoke public, anon; grant authenticated (1007a:338-339) | 1007a:219 (prior 0622:145, 0814b:68, 1005c:354) | is_admin(); R/W orders (FOR UPDATE), products, product_variants (restock) |
| decrement_stock | (product_id uuid, qty integer) → void | SD sql | revoke anon, public (0623:202) — **authenticated still has default EXECUTE** | 0623:194 (orig 0329a:92) | W products. Unused by src. |
| attach_payment_proof | (p_order_id uuid, p_path text) → jsonb | SD | revoke public, anon; grant authenticated (1007a:125-126) | 1007a:84 | R orders, storage.objects ('payment-proofs'); W orders |
| admin_set_eft_payment | (p_order_id uuid, p_received boolean, p_amount_cents integer default null) → jsonb | SD | revoke public, anon; grant authenticated (1007a:181-182) | 1007a:129 | is_admin(); R/W orders |
| get_orders_by_email | — | — | — | **dropped 1007b:11** (was 0806:18) | — |

### Discounts
| fn | sig | SD | grants | def | notes |
|---|---|---|---|---|---|
| discount_eval | (p_code text, p_subtotal_cents integer, p_uid uuid) → jsonb | SD | revoke public, anon, authenticated (0814d:192) | 0814d:99 | R discount_codes **by code only (global)** 0814d:120, orders (first-order test by user_id, all stores) 0814d:160-164. Literal 'Spend at least R' 0814d:145 (ZAR). |
| validate_discount_code | (p_code text, p_subtotal_cents integer) → jsonb | SD | revoke public, anon; grant authenticated (0814d:223-224) | 0814d:207 | wraps discount_eval |

### Memberships
| fn | sig | SD | grants | def | notes |
|---|---|---|---|---|---|
| place_membership | (p_customer jsonb, p_tier text, p_reference text) → jsonb | SD | revoke public, anon; grant authenticated (1005b:157-158) | **1005b:29** (prior 0623:133, 0813:128) | R auth.users, membership_tiers **by slug (global)** 1005b:60-62, memberships (one live per user, all stores) 1005b:122-129. W memberships. **21:** `interval '21 years'` 1005b:82, 'Must be 21 or older' 1005b:83, consent key `'age_21'` 1005b:48. |
| admin_update_membership_status | (p_id uuid, p_status text) → jsonb | SD | revoke public, anon; grant authenticated (1005b:222-223) | 1005b:162 (prior 0813:220) | is_admin(); R memberships, membership_tiers (by id, fallback **by slug** 1005b:190), auth.users (approved_by); W memberships |
| admin_create_membership | (p_customer jsonb, p_tier_slug text) → jsonb | SD | revoke public, anon; grant authenticated (0813:347-348) | 0813:291 | is_admin(); R membership_tiers by slug 0813:303; W memberships. **21:** 0813:323-324 |
| admin_link_membership_user | (p_membership_id uuid, p_email text) → jsonb | SD | revoke public, anon; grant authenticated (0813:416-417) | 0813:361 | is_admin(); R auth.users, memberships; W memberships |
| membership_effective_status | (m memberships) → text | **not SD** | anon, authenticated (0813:438) | 0813:425 | computed column; pure |

### Events
| fn | sig | SD | grants | def | notes |
|---|---|---|---|---|---|
| event_seats_remaining | (e events) → int | SD sql stable | revoke public; grant anon, authenticated (0814c:108-109) | 0814c:89 | computed column; R event_reservations |
| reserve_event_seats | (p_event_id uuid, p_quantity int, p_customer jsonb) → jsonb | SD | revoke public, anon; grant authenticated (0814c:226-227) | 0814c:114 | R auth.users, events (FOR UPDATE), memberships (member gate, any store), event_reservations; W event_reservations |
| admin_update_reservation_status | (p_id uuid, p_status text) → jsonb | SD | revoke public, anon; grant authenticated (0814c:276-277) | 0814c:233 | is_admin(); R/W event_reservations |

### Newsletter
| fn | sig | SD | grants | def | notes |
|---|---|---|---|---|---|
| subscribe_newsletter | (p_email text, p_first_name text default null, p_last_name text default null) → jsonb | SD | revoke all public; grant anon, authenticated, service_role (0814a:146-147) | 0814a:111 | W newsletter_subscribers. **`on conflict (email)` 0814a:134** |
| unsubscribe_newsletter | (p_token uuid) → jsonb | SD | revoke all public; grant anon, authenticated, service_role (0814a:94-95) | 0814a:63 | W newsletter_subscribers by token |
| newsletter_normalize_email | () → trigger | not SD | none | 0814e:173 | sets new.email lower(trim) |

### Reviews
| fn | sig | SD | grants | def | notes |
|---|---|---|---|---|---|
| has_delivered_purchase | (p_uid uuid, p_product_id uuid) → boolean | SD sql stable | revoke public, anon, authenticated (1005e:70) | 1005e:55 | R orders (items @> product id) |
| my_review_status | (p_product_id uuid) → jsonb | SD stable | revoke public, anon; grant authenticated (1005e:97-98) | 1005e:73 | R product_reviews |
| submit_product_review | (p_product_id uuid, p_rating int, p_body text, p_display_name text) → jsonb | SD | revoke public, anon; grant authenticated (1005e:143-144) | 1005e:100 | W product_reviews **`on conflict (product_id, user_id)` 1005e:130** |
| get_product_reviews | (p_product_id uuid) → jsonb | SD sql stable | anon, authenticated (1005e:172) | 1005e:147 | R product_reviews |
| product_reviews_moderated | () → trigger | not SD | none | 1005e:175 | |

### Products / variants
| fn | sig | SD | grants | def | notes |
|---|---|---|---|---|---|
| sync_product_totals | (p_product_id uuid) → void | SD sql | revoke public, anon, authenticated (1005c:81) | 1005c:62 | W products from product_variants |
| sync_product_from_variants | () → trigger | SD | revoke public, anon, authenticated (1005c:100) | 1005c:83 | |

### Saved carts / reminders
| fn | sig | SD | grants | def | notes |
|---|---|---|---|---|---|
| saved_carts_touch | () → trigger | not SD | none | 1005d:58 | `current_user in ('anon','authenticated')` 1005d:69 |
| stop_cart_reminders | (p_token uuid) → boolean | SD | revoke public; grant anon, authenticated (1005d:112-113) | 1005d:97 | W customer_email_prefs |
| claim_cart_reminders | (p_limit int default 50) → table(recipient_id uuid, recipient_email text, cart_items jsonb, opt_out_token uuid) | SD | revoke public, anon, authenticated; grant service_role (1005d:171-172) | 1005d:120 | R saved_carts (FOR UPDATE SKIP LOCKED), customer_email_prefs, orders (any store), auth.users; W customer_email_prefs **`on conflict (user_id)` 1005d:155**, saved_carts.reminded_at. Literals interval '3 hours'/'7 days'. |
| release_cart_reminders | (p_user_ids uuid[]) → void | SD sql | service_role only (1005d:185-186) | 1005d:176 | W saved_carts |

### Analytics
| fn | sig | SD | grants | def | notes |
|---|---|---|---|---|---|
| track_event | (p_visitor uuid, p_session uuid, p_event text, p_path text, p_source text default null, p_device text default null) → void | SD | revoke public; grant anon, authenticated (1007c:68-69) | 1007c:34 | R/W site_events (flood guard per visitor) |
| site_analytics | (p_days int default 7) → jsonb | SD stable | revoke public, anon; grant authenticated (1007c:158-159) | 1007c:73 | is_admin(); R site_events, **auth.users (signups, all stores)** 1007c:105-110. Literals 'Africa/Johannesburg', `'vitest+%'`. |

### Drivers / delivery
| fn | sig | SD | grants | def | notes |
|---|---|---|---|---|---|
| admin_assign_driver | (p_order_id uuid, p_driver_id uuid) → void | SD | revoke public, anon; grant authenticated (1007d:92-93) | 1007d:74 | is_admin(); R drivers; W orders.driver_id |
| admin_driver_locations | () → jsonb | SD stable | same (1007d:121-122) | 1007d:96 | R drivers, driver_locations, orders |
| driver_start_delivery | (p_order_id uuid) → jsonb | SD | same (1007d:161-162) | 1007d:125 | is_driver(); R/W orders |
| driver_complete_delivery | (p_order_id uuid) → jsonb | SD | same (1007d:202-203) | 1007d:164 | is_driver(); W orders, D driver_locations |
| driver_update_location | (p_lat dp, p_lng dp, p_accuracy real default null, p_heading real default null, p_speed real default null) → **jsonb** | SD | revoke public, anon; grant authenticated (1008c:97-98) | **1008c:48** (prior boolean version 1007d:207, dropped 1008c:46) | W driver_locations **`on conflict (driver_id)` 1008c:73**, orders.nearby_notified_at (1 km) |
| get_delivery_location | (p_order_number text, p_email text) → jsonb | SD sql stable | anon, authenticated (1008c:128) | 1008c:102 (prior 1007d:246) | R orders, drivers, driver_locations |
| distance_m | (lat1, lng1, lat2, lng2 dp) → dp | not SD, immutable | anon, authenticated (1008c:41) | 1008c:26 | pure |
| admin_becomes_driver | () → trigger | SD | revoke public, anon, authenticated (1007e:29) | 1007e:15 | W drivers **`on conflict (user_id)` 1007e:24**; literal 'Admin'. Backfill insert 1007e:10-13 (`on conflict (user_id)`). |
| (admin_create_driver) | — | — | — | **not SQL**: Edge Function `supabase/functions/admin-create-driver/index.ts` (auth.admin.createUser + `drivers` upsert onConflict 'user_id' :67-68) | |

### Age verification
| fn | sig | SD | grants | def | notes |
|---|---|---|---|---|---|
| set_date_of_birth | (p_dob date) → jsonb | SD | revoke public, anon; grant authenticated (1008a:60-61) | 1008a:29 | W customer_profiles. **21:** 1008a:43-44 |
| my_age_verified | () → boolean | SD sql stable | revoke public, anon; grant authenticated (1008a:77-78) | 1008a:63 | R customer_profiles. **21:** 1008a:73 |
| profile_from_signup | () → trigger | SD | revoke public, anon, authenticated (1008a:108) | 1008a:81 | reads new.raw_user_meta_data->>'date_of_birth'; W customer_profiles **`on conflict (user_id)` 1008a:100**. **21:** 1008a:97. Backfill from memberships 1008a:116-123 (21 at :121). |

### Owner alerts / daily summary / telegram
| fn | sig | SD | grants | def | notes |
|---|---|---|---|---|---|
| daily_summary_data | (p_day date) → jsonb | SD stable | revoke public, anon, authenticated; grant service_role (1008b:89-90) | 1008b:19 | R site_events, auth.users, orders, product_reviews, memberships, products, product_variants — **all unscoped**. Literals 'Africa/Johannesburg', `'vitest+%'`, `'vitest-%'`, low-stock <=5. |
| admin_daily_summary | (p_day date default null) → jsonb | SD stable | revoke public, anon; grant authenticated (1008e:22-23) | 1008e:9 | is_admin(); wraps daily_summary_data |
| admin_get_alert_settings | () → jsonb | SD stable | revoke public, anon; grant authenticated (1008d:52-53) | 1008d:30 | R alert_settings **where id = 1**, vault.secrets name 'telegram_bot_token' |
| admin_update_alert_settings | (p_enabled boolean, p_kinds jsonb) → void | SD | same (1008d:75-76) | 1008d:56 | W alert_settings id = 1 |
| store_telegram_token | (p_token text) → void | SD | service_role only (1008d:105-106) | 1008d:81 | vault.create_secret/update_secret **'telegram_bot_token'**; W alert_settings id=1 |
| set_telegram_chat | (p_chat_id bigint, p_title text) → void | SD sql | service_role only (1008d:120-121) | 1008d:108 | W alert_settings id=1 |
| telegram_config | () → jsonb | SD sql stable | service_role only (1008d:139-140) | 1008d:123 | R vault.decrypted_secrets 'telegram_bot_token', alert_settings id=1 |

### Capability probes (immutable sql, `select true`, granted anon+authenticated)
order_cancel_restocks 0814b:175 · discount_newsletter_fixes_applied 0814e:476 · product_variants_applied 1005c:472 · cart_reminders_applied 1005d:189 · eft_verification_applied 1007a:342 · age_verification_applied 1008a:378.

### Literal summary (SQL)
- `'224-'`: place_cod_order final 1008a:305 (also historic 0622:31 backfill update, 0622:81, 0623:93, 0808:96, 0813:520, 0814d:351, 0814e:350, 1001a:169, 1005c:279).
- `'224 Rondebult Road, Libradene, Boksburg'`: events.location default 1001b:2.
- `'admin@224clubhouse.co.za'`: admin seed 0604:58.
- Project URL `https://aogdkqczvlffgydgxsmz.supabase.co/functions/v1/...`: 1005d:211, 1008b:98.
- `'Africa/Johannesburg'`: 1007c:82-106, 1008b:27-28, 1008e:18.
- No `'224 Clubhouse'` string literal in any SQL function body (only in comments). Perk text "Join the 224 community" is data (1005a:15).

---

## 4. Triggers (6)
| trigger | table | timing / events | function | file:line |
|---|---|---|---|---|
| newsletter_subscribers_normalize_email | newsletter_subscribers | BEFORE INSERT OR UPDATE OF email, row | newsletter_normalize_email() | 0814e:190-192 |
| product_variants_sync | product_variants | AFTER INSERT OR UPDATE OR DELETE, row | sync_product_from_variants() | 1005c:103-105 |
| saved_carts_touch | saved_carts | BEFORE INSERT OR UPDATE, row | saved_carts_touch() | 1005d:77-79 |
| product_reviews_moderated | product_reviews | BEFORE UPDATE, row | product_reviews_moderated() | 1005e:189-191 |
| admin_users_become_driver | admin_users | AFTER INSERT, row | admin_becomes_driver() | 1007e:32-34 |
| **on_auth_user_profile** | **auth.users** | AFTER INSERT, row | profile_from_signup() | 1008a:111-113 |

(The prompt's name `profile_from_signup` is the function; the trigger is `on_auth_user_profile`.)

---

## 5. Cron / pg_net / vault
Extensions: `pg_cron`, `pg_net with schema extensions` — 1005d:199-200.

| job | schedule (UTC) | action | file:line |
|---|---|---|---|
| send-cart-reminders | `17 * * * *` | net.http_post `https://aogdkqczvlffgydgxsmz.supabase.co/functions/v1/send-cart-reminders`, header x-cron-secret from vault `cart_reminders_cron_secret` | 1005d:205-221 |
| purge-saved-carts | `40 2 * * *` | delete saved_carts older than 30 days | 1005d:224-229 |
| purge-site-events | `50 2 * * *` | delete site_events older than 13 months | 1007c:162-167 |
| purge-driver-locations | `55 2 * * *` | delete driver_locations older than 1 day | 1007d:271-276 |
| send-daily-summary | `0 5 * * *` | net.http_post `.../functions/v1/send-daily-summary`, same vault secret | 1008b:92-108 |

Vault secret names: `cart_reminders_cron_secret` (created outside migrations; shared by both http jobs; compared to each function's `CRON_SECRET` env), `telegram_bot_token` (created by store_telegram_token 1008d:95).

Hard-coded project URL elsewhere: `src/__tests__/helpers/liveFixtures.js:51` (fallback), `scripts/build-auth-email-templates.mjs:11`, `scripts/image-manifest.json` (publicUrl entries). Edge Functions build URLs from env `SUPABASE_URL` (`_shared/brand.ts:4`, `_shared/supabaseClients.ts:5`).

---

## 6. Minimum age (21) — every occurrence

### SQL (final, live)
| file:line | function | form |
|---|---|---|
| 1008a:178-180 | place_cod_order | `date_of_birth <= (current_date - interval '21 years')::date`; msg 'Age check: please confirm your date of birth…' |
| 1005b:82-83 | place_membership | `> (current_date - interval '21 years')` → 'Must be 21 or older' |
| 1005b:48 | place_membership | required consent key `'age_21'` |
| 0813:323-324 | admin_create_membership | `interval '21 years'` → 'Must be 21 or older' |
| 1008a:43-44 | set_date_of_birth | `interval '21 years'` → 'Age check: you must be 21 or older to order' |
| 1008a:73 | my_age_verified | `interval '21 years'` |
| 1008a:97 | profile_from_signup (trigger on auth.users) | only stores DOB if 21+ |
| 1008a:121 | one-off backfill from memberships (already run) | 21+ filter |

Historic (superseded, but still in migration files): 0623:158-159 (place_membership v1), 0813:165-166 (place_membership v2).

Note: because customer_profiles only ever holds 21+ DOBs (set_date_of_birth rejects, trigger skips), an 18-20 customer has no row at all — an 18+ store needs these writers changed, not only the readers.

### src/
| file:line | what |
|---|---|
| src/utils/age.js:5 | `export const MIN_AGE = 21` (used by latestAdultDob/isAdultDob :10-22) |
| src/components/auth/CustomerAuth.jsx:6, 63, 69 (comment), 242 | imports MIN_AGE; messages |
| src/pages/Checkout.jsx:11, 138 (comment), 166 ('Please confirm you are 21 or older' — hard 21), 175, 229 (comment), 447, 473 (hard '21 years of age or older') |
| src/pages/Membership.jsx:87-89 (comment), **96 (`today.getFullYear() - 21` — hard-coded, not MIN_AGE)**, 196 (hard 'You must be 21 or older') |
| src/components/admin/MembershipForm.jsx:11-14 (comment), **18 (`d.setFullYear(d.getFullYear() - 21)`)**, 35, 37, 92 |
| src/components/membership/paperForm.js:17 | consent `{ key: 'age_21', text: 'I confirm that I am 21 years of age or older.' }` — key must match SQL 1005b:48 |
| src/components/membership/PaperApplication.jsx:85, 104 |
| src/components/layout/AgeGate.jsx:40, 49, 55 | "21 or older?", "Under 21", "21+" |
| src/components/layout/Footer.jsx:126 | "under 21 years of age" |
| src/pages/EventDetail.jsx:168, 323 |
| src/pages/Invoice.jsx:280 |
| src/pages/legal/DeliveryReturns.jsx:44, 46, 47 · Terms.jsx:21, 25, 27, 83, 106 · PrivacyPolicy.jsx:40, 50, 90, 195 |
| src/context/AuthContext.jsx:128 (comment) · src/hooks/useAgeVerification.js:5-6 (comment) |
| tenants/224clubhouse/tenant.json:205, 213 (copy text; `content.ageGate` at :242 has no numeric age field) |

### Edge Functions (footer copy)
send-cart-reminders/index.ts:86 · send-membership-email/index.ts:138 · send-order-email/index.ts:446 · send-payment-email/index.ts:40 · send-status-email/index.ts:177. Also scripts/build-auth-email-templates.mjs:34.

### Tests
- src/__tests__/ageVerification.contract.test.js:5-6, 76-78 (`yearsAgo(20)` rejected, expects `/21 or older/`), 81-82 (`yearsAgo(30)`).
- src/__tests__/helpers/liveFixtures.js:373-381 `giveAdultProfile` upserts DOB '1990-01-01'.
- src/__tests__/membership.contract.test.js:72 (`age_21: true` consent), :83, :328 (DOB 1990).
- src/utils/age.test.js:7-12 (expects '2005-10-08' for 21).

---

## 7. Callers

### RPCs → callers
| RPC | src/ | Edge Functions / scripts |
|---|---|---|
| is_admin | context/AuthContext.jsx:32, :112-114 (timeBoxed) | _shared/supabaseClients.ts:34 `callerIsAdmin` (used by admin-create-driver:37, geocode-order:55, send-membership-email:44, send-payment-email:112, send-status-email:89, telegram-connect:36); scripts/verify-admin.mjs:38 |
| is_driver | AuthContext.jsx:42, :114 | geocode-order:60, send-status-email:94 |
| place_cod_order | pages/Checkout.jsx:198 | |
| get_order_tracking | hooks/useOrderTracking.js:19 | |
| admin_update_order_status | hooks/useOrders.js:41 | |
| attach_payment_proof / admin_set_eft_payment | hooks/useEftPayments.js:32 / :52 | |
| validate_discount_code | hooks/useDiscountCode.js:104, :149 | |
| place_membership | pages/Membership.jsx:104 | |
| admin_update_membership_status / admin_create_membership / admin_link_membership_user | hooks/useMemberships.js:30 / :66 / :84 | |
| membership_effective_status | not used by src (client mirrors it: useMyMembership.js:6, admin/Memberships.jsx:32) | |
| event_seats_remaining (computed col) | hooks/useEvents.js:9 `EVENT_SELECT = '*, seats_remaining:event_seats_remaining'` | |
| reserve_event_seats / admin_update_reservation_status | hooks/useEventReservations.js:61 / :107 | |
| subscribe_newsletter | pages/Home.jsx:44 (then invokes send-welcome-email :52) | |
| unsubscribe_newsletter | hooks/useNewsletterSubscribers.js:48 | |
| get_product_reviews / my_review_status / submit_product_review | hooks/useProductReviews.js:13 / :27 / :39 | |
| stop_cart_reminders | hooks/useSavedCart.js:73 | |
| claim_cart_reminders / release_cart_reminders | | send-cart-reminders:105 / :141 |
| track_event | utils/analytics.js:88 | |
| site_analytics | hooks/useSiteAnalytics.js:9 | |
| driver_start_delivery / driver_complete_delivery | hooks/useDelivery.js:36 (dynamic `rpc` name via useDriverStatusMutation) | |
| driver_update_location | hooks/useDelivery.js:90 | |
| get_delivery_location | hooks/useDelivery.js:138 | |
| admin_assign_driver / admin_driver_locations | hooks/useDelivery.js:197 / :208 | |
| set_date_of_birth / my_age_verified | hooks/useAgeVerification.js:27 / :14 | |
| admin_get_alert_settings / admin_update_alert_settings | hooks/useAlertSettings.js:12 / :23 | |
| admin_daily_summary | hooks/useDailySummary.js:9 | |
| daily_summary_data | | send-daily-summary:121 |
| telegram_config | | telegram-connect:25, _shared/telegram.ts:45 |
| store_telegram_token / set_telegram_chat | | telegram-connect:49 / :80 |
| decrement_stock, discount_eval, has_delivered_purchase, sync_*, probes | none in src (probes only in tests) | |

Edge Functions invoked from src: send-status-email (useDelivery.js:39), geocode-order (useDelivery.js:43), admin-create-driver (useDelivery.js:167), telegram-connect (useAlertSettings.js:32), send-welcome-email (Home.jsx:52), plus send-order-email from Checkout (per CLAUDE.md).

### `.from('<table>')` — src/ (anon/user JWT; RLS applies)
| table | file:line — op |
|---|---|
| products | hooks/useProducts.js:13, 34, 53, 65 — select `PRODUCT_SELECT = '*, product_variants(*)'` (:6, embed); components/admin/ProductForm.jsx:161 update, :168 **insert**; pages/admin/Products.jsx:28 update, :39 delete |
| product_variants | components/admin/ProductForm.jsx:100 delete, :116 update, :117 **insert** |
| product_reviews | hooks/useProductReviews.js:68 select (embed `products(name, slug)` :69), :84 update, :98 delete |
| events | hooks/useEvents.js:17, 41, 57 select (EVENT_SELECT), :77 update; components/admin/EventForm.jsx:71 update, :77 **insert**; pages/admin/Events.jsx:230 delete |
| event_reservations | hooks/useEventReservations.js:29 select (eq user_id), :87 select (admin) |
| membership_tiers | hooks/useMembershipTiers.js:17 select; hooks/useMemberships.js:102 select, :118 **insert**, :129 update |
| memberships | hooks/useMemberships.js:9 select, :143 update (admin_notes); hooks/useMyMembership.js:47 select (eq user_id) |
| orders | hooks/useOrders.js:11, 25 select; hooks/useMyOrders.js:19, 45, 67 select (eq user_id); hooks/useInvoiceOrder.js:23 select (+eq user_id if not admin); hooks/useSalesReport.js:21 select; hooks/useDelivery.js:19 select (eq driver_id) |
| discount_codes | hooks/useDiscountCode.js:18 select; pages/admin/Discounts.jsx:135 update, :139 **insert**, :287 update |
| newsletter_subscribers | hooks/useNewsletterSubscribers.js:17 select |
| contact_messages | hooks/useContactMessages.js:9 select; pages/Contact.jsx:76 **insert** |
| saved_carts | hooks/useSavedCart.js:24 select, :34-35 **upsert `{ onConflict: 'user_id' }`**, :40 delete |
| drivers | hooks/useDelivery.js:156 select, :186 update |
| site_events, customer_profiles, customer_email_prefs, driver_locations, admin_users, alert_settings | no direct src access |

Storage from src: event-images (EventForm.jsx:39,44), product-images (ProductForm.jsx:65,70), payment-proofs (useEftPayments.js:27 upload `<uid>/<order>/…`, :73 signed URL).

### `.from()` — Edge Functions (all via `serviceClient()` = service role, **RLS bypassed**)
| table | file:line — op |
|---|---|
| drivers | admin-create-driver:67-68 **upsert onConflict 'user_id'**; send-status-email:109 select |
| orders | geocode-order:48 select, :77 update; send-order-email:310 select; send-payment-email:72 select; send-status-email:79 select |
| memberships | send-membership-application-alert:44 select; send-membership-email:49 select |
| membership_tiers | send-membership-application-alert:56-57, send-membership-email:62-63 — select by id, **fallback by slug** |
| product_variants | send-order-email:133 select (embed `products(name)`) |
| products | send-order-email:148 select |
| product_reviews | send-review-alert:33 select (embed `products(name)`) by product_id+user_id |
| newsletter_subscribers | send-welcome-email:44 select **by email** |

Env vars read by functions (names only): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, RESEND_API_KEY, MAIL_FROM_DOMAIN (default '224clubhouse.co.za'), ADMIN_ALERT_EMAIL, CRON_SECRET, EFT_BANK_DETAILS. Every function also hard-codes `SITE_URL = 'https://224clubhouse.store'` and "224 Clubhouse" sender/subject/footer copy (e.g. send-order-email:51, 271, 439, 467; send-cart-reminders:14, 86, 122-124; geocode-order:15 user agent).

### Service-role scripts (`scripts/`, read `.env.local`: VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
seed.js (:350-351 delete all products/events, :356 / :373 insert), fetch-product-images.js (:176, :198 products), setup-buckets.js (buckets incl. brand-assets), upload-images.js (storage upsert), provision-admin.mjs (auth.admin create; ADMIN_EMAIL literal :35), verify-admin.mjs (:27 admin_users select, :38 is_admin).

---

## 8. Tests

Runner: vitest (`package.json` scripts `test`, `test:contract`, `predeploy`). `vite.config.js:43` setupFiles `./test/loadEnv.mjs`; `:48` globalSetup `./test/globalSetup.mjs`; files run serially.

**Keys (names only):** `VITE_SUPABASE_URL` (or `SUPABASE_URL`), `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — loaded from `.env.local` by `test/loadEnv.mjs:62-74` (process.env wins), consumed in `liveFixtures.js:48-54` (`URL` falls back to the hard-coded project URL :51). `KEYS_MISSING` → suites skip.

**Fixtures (`src/__tests__/helpers/liveFixtures.js`):**
- `RUN_TAG` per process (:62); prefixes `vitest+` (email), `vitest-` (slug), `Vitest Event ` (title), `VITEST-` (code) (:67-78).
- `createTestUser` (:353) → `auth.admin.createUser` (email_confirm) + `giveAdultProfile` (:378, customer_profiles upsert DOB 1990-01-01 onConflict user_id).
- `grantPendingMembership` (:407) inserts memberships directly with service role (tier 'daily', amount 1000).
- Admin rights: suites insert into `admin_users` with service role (adminDailySummary:38, driverPortal:56, eftVerification:51, restock:148-150, siteAnalytics:40, storeUpgrades:99, telegramAlerts:37); removed via auth user cascade.
- `deleteTestUsers` (:429); `sweepStaleFixtures` (:459) called once by `test/globalSetup.mjs:26-32` — deletes rows older than 30 min (`STALE_AFTER_MS` :444) by prefix from event_reservations, orders, memberships, events, products, discount_codes, newsletter_subscribers (:475-488), then stale `vitest+` auth users (:493-501).
- `probeMigration`/`describeGate` (:269, :318) gate each suite on a probe RPC/table.

| test file | tables | RPCs | `224-` assertion |
|---|---|---|---|
| api.contract.test.js (L1, service role, `.limit(0)`) | products, events, orders, memberships, contact_messages | — | |
| api.anonContract.test.js (L2, anon) | products/events positive; orders, memberships, newsletter_subscribers, contact_messages negative (:69-97) | — | |
| cod.contract.test.js | orders, products | place_cod_order, get_order_tracking, admin_update_order_status | **:140** `/^224-/` |
| ageVerification.contract.test.js | customer_profiles, orders, products | age_verification_applied, my_age_verified, set_date_of_birth, place_cod_order | **:87** |
| discountCodes.contract.test.js | discount_codes, memberships, orders, products | validate_discount_code, place_cod_order, get_order_tracking, discount_newsletter_fixes_applied | **:382** |
| restock.contract.test.js | admin_users, memberships, orders, products | order_cancel_restocks, place_cod_order, admin_update_order_status | **:173** |
| membership.contract.test.js | membership_tiers, memberships, orders, products | place_membership, admin_update_membership_status, admin_create_membership, place_cod_order | |
| deliveryFeedback.contract.test.js | membership_tiers, memberships, orders, products | place_cod_order | |
| deliveryEta.contract.test.js | drivers, orders, products | distance_m, driver_start_delivery, driver_update_location, get_delivery_location, place_cod_order | |
| driverPortal.contract.test.js | admin_users, driver_locations, drivers, memberships, orders, products | admin_assign_driver, admin_driver_locations, driver_start/complete_delivery, driver_update_location, get_delivery_location, is_driver, place_cod_order | |
| eftVerification.contract.test.js | admin_users, orders, products, storage payment-proofs | admin_set_eft_payment, admin_update_order_status, attach_payment_proof, eft_verification_applied, get_order_tracking, place_cod_order | |
| eventReservations.contract.test.js | event_reservations, events | reserve_event_seats, admin_update_reservation_status | |
| newsletter.contract.test.js | newsletter_subscribers | subscribe_newsletter, unsubscribe_newsletter, discount_newsletter_fixes_applied | |
| ordersByEmailRetired.contract.test.js | — | get_orders_by_email (asserts absent) | |
| ownerAlerts.contract.test.js | — | daily_summary_data | |
| adminDailySummary.contract.test.js | admin_users | admin_daily_summary | |
| siteAnalytics.contract.test.js | admin_users, site_events | track_event, site_analytics | |
| storeUpgrades.contract.test.js | admin_users, memberships, orders, product_reviews, product_variants, products, saved_carts | product_variants_applied, cart_reminders_applied, claim_cart_reminders, stop_cart_reminders, get_product_reviews, my_review_status, submit_product_review, place_cod_order, admin_update_order_status | |
| telegramAlerts.contract.test.js | admin_users, alert_settings | admin_get/update_alert_settings, set_telegram_chat, store_telegram_token, telegram_config | |
| rlsEmbedAudit.test.js | runs `node scripts/audit-embed-rls.mjs --json` (:28), expects problems = 0 | | |
| migrationGate.unit.test.js | classifyProbeResult unit tests | | |
| brandLiterals / browserImports / tenant / loadTenant / theme / indexHtml unit tests | tenant config guards (no DB) | | |

---

## 9. Audit script (`scripts/audit-embed-rls.mjs`)

Structure:
- Constants: `SRC` (:44), `MIGRATIONS` (:45), `--json` flag (:47).
- **Embed finder**: `EMBED_RE = /\.select\(\s*['"`]([^'"`]+)['"`]/g` (:50), `EMBED_INNER_RE = /(\w+)(?::\w+)?\s*\(/g` (:51); `walk()` (:53-67) skips `__tests__` and `*.test|spec.*`; `findEmbeds()` (:69-91) returns `[{file, line, embeds[], raw}]`.
- **Policy harvester**: `POLICY_RE` (:100)
  `/CREATE\s+POLICY\s+(?:"([^"]+)"|'([^']+)'|(\w+))\s+ON\s+(\w+)\s+FOR\s+(\w+)[\s\S]*?USING\s*\(([\s\S]+?)\)\s*(?:WITH\s+CHECK|;)/gi`
  `classifyRls()` (:102-126) reads every `*.sql` sorted, keeps **only `FOR SELECT`** matches, builds `Map<table, {policies:[{policy,file,openish,ownerOnly,using}], hasOpenSelect, hasRowRestrictedSelect}>`. `openish` = USING is exactly `true` (:115); `ownerOnly` = USING matches `/auth\.uid\(\)|is_admin|auth\.role\(\)|owner|self/i` (:116).
- `OPEN_TABLES` = {products, events} (:132-138); `EXEMPT_EMBEDS` Map keyed `file:line:embed` (:145-147), `isExempt()` (:149-156).
- Report loop (:159-185) → statuses open / exempt / RISKY / unknown; output table or JSON `{rows, problems}` (:187-198); exit 1 if problems (:200).

Measured behaviour of `POLICY_RE` against the current migrations (ran the regex locally, no DB): 45 of 68 `create policy` statements match; 17 matched SELECT. **Missed (23):** every `storage.objects` policy (10) because `ON\s+(\w+)\s+FOR` cannot match a dotted name; plus products_auth_update, events_auth_update, newsletter_auth_select, memberships_auth_select, products_admin_update, events_admin_update, **contact_admin_select**, product_variants_admin_update, saved_carts_owner_update — swallowed because a preceding INSERT policy has no `USING`, so the lazy `[\s\S]*?USING` runs into the next statement and consumes it.

Other gaps relevant to a tenant-predicate check:
- Not final-state aware: no `DROP POLICY` handling; dropped policies (memberships_auth_*, orders_auth_all, newsletter_auth_select) are still counted.
- Only `USING` is captured; `WITH CHECK` is ignored (INSERT policies have none). `FOR ALL` policies are seen but discarded (SELECT-only filter :113).
- Embed scan sees only literal `.select('…')` strings: misses `select(PRODUCT_SELECT)` (`useProducts.js:6`, embed `product_variants(*)`) and `EVENT_SELECT`; does not scan `supabase/functions/` (embeds at send-order-email:134, send-review-alert:34). Header comment (":14 ZERO embeds") is stale — current run reports 1 embed (`useProductReviews.js:69 products`, open).
- Does not look at function bodies at all (SECURITY DEFINER RPCs are where most tenant scoping would have to live).

An extension that asserts "every policy on a tenant table references `tenant`" needs a statement-level parser (split on `;` outside `$$` blocks), dotted table names, DROP tracking for final state, and both USING and WITH CHECK.

---

## 10. Surprises for a tenant migration

1. **Singleton `alert_settings` (`id int PK default 1 check (id = 1)`, 1008d:16)** and every telegram RPC hard-codes `where id = 1` (1008d:41, 71, 101, 117, 136). Vault secret name `telegram_bot_token` is a single global name (1008d:43, 93-95, 131). Per-store alerts need a PK change and per-store secret names.
2. **Per-user PKs**: saved_carts, customer_profiles, customer_email_prefs, drivers, driver_locations, admin_users are keyed on the auth user id alone. Adding `tenant` does not let one account have a cart / admin grant / driver row in two stores; `on conflict (user_id)` targets (1005d:155, 1007e:13/24, 1008a:100/123, src useSavedCart.js:35, admin-create-driver:68, liveFixtures:381) all depend on that PK.
3. **Global unique keys**: products.slug, membership_tiers.slug, discount_codes.code (+ seeds `on conflict (slug|code)` 0813:82, 0814d:78), newsletter_subscribers.email (`on conflict (email)` in subscribe_newsletter 0814a:134 and send-welcome-email lookup by email), orders.order_number (global uniqueness loop 1008a:306). Lookups by slug/code without tenant: place_membership 1005b:60, admin_create_membership 0813:303, admin_update_membership_status fallback 1005b:190, discount_eval 0814d:120, membership Edge Functions slug fallback.
4. **Global identity predicates in SECURITY DEFINER code** that would leak or block across stores: `is_admin()` / `is_driver()` (no tenant), membership gates in place_cod_order / reserve_event_seats (`m.user_id = v_uid` any store), "membership required after first order" (orders of any store, 1008a:190-199), discount first-order test (0814d:160), has_delivered_purchase, claim_cart_reminders `orders since cart` check, place_membership one-live-application check. `pg_advisory_xact_lock(hashtextextended(v_uid::text,0))` serialises a user across all stores (harmless).
5. **Unscoped aggregates**: site_analytics counts `auth.users` signups (1007c:105-110) and daily_summary_data counts auth.users, orders, reviews, memberships, products (1008b:30-85) with no store filter; send-daily-summary is a single cron job to one ADMIN_ALERT_EMAIL.
6. **Cron jobs and pg_net URLs are single-project / single-store**: two http jobs with the hard-coded project URL (1005d:211, 1008b:98) and one shared vault secret.
7. **Policies with `true`**: products_public_select, events_public_select, product_variants_public_select (USING true); newsletter_public_insert and contact_public_insert (WITH CHECK true) — anon can insert any row directly, so a `tenant` value supplied by the client would be unchecked unless the policy pins it. membership_tiers_public_select uses `is_active` only.
8. **Literal store data in SQL**: `'224-'` order prefix (1008a:305; historic 0622:31 backfill); events.location default '224 Rondebult Road, Libradene, Boksburg' (1001b:2); admin seed email (0604:58); shipping fee/threshold 3000/50000 in place_cod_order (1008a:301); 'Africa/Johannesburg' timezone; ZAR 'R' in discount_eval message (0814d:145); payment-method whitelist incl. 'eft'.
9. **Age 21 is enforced in 7 SQL places plus a writer that refuses to store under-21 DOBs** (section 6); the consent key `'age_21'` is shared between SQL (1005b:48) and `paperForm.js:17`. Membership.jsx:96 and MembershipForm.jsx:18 hard-code 21 instead of `MIN_AGE`.
10. **Default grants**: `decrement_stock` (0623:194) is SECURITY DEFINER, revoked only from anon/public — `authenticated` keeps Supabase's default EXECUTE, so any signed-in user can decrement any product's stock (pre-existing, not tenant-specific). `is_admin()` has no explicit grant statement at all.
11. **memberships.status default is still `'active'`** (0329b:13) — any direct insert without status (service-role scripts/tests) creates an active membership.
12. **Storage paths are not store-scoped**: product-images / event-images are flat buckets shared by every store; payment-proofs path is `<uid>/<order id>/`; the insert policy embeds a subquery on `public.orders` (1007a:55-62) that would need the tenant predicate too. `brand-assets` bucket is only created by a script.
13. **Edge Functions bypass RLS** (service role) and select by id/email/slug; all hard-code 224 branding (SITE_URL, MAIL_FROM_DOMAIN default, footer address, sender names).
14. **Audit script gaps** (section 9): misses all storage policies and ~9 public policies through regex over-consumption, ignores WITH CHECK and DROP POLICY, cannot see variable select strings or Edge Function embeds.
15. Tests: 4 contract tests assert `/^224-/` (cod:140, ageVerification:87, discountCodes:382, restock:173); fixtures insert memberships/admin_users/customer_profiles directly with the service role and will need a tenant value once the column is NOT NULL; `sweepStaleFixtures` deletes by prefix without tenant.
16. Not present (checked): no views, no materialized views, no SECURITY DEFINER views, no dynamic SQL (`execute format`), no realtime publication (Firebase does live status), no sequences besides site_events identity, no expression unique indexes (email lowercase is a trigger), no tables without RLS.
