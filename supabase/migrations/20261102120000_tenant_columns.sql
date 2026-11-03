-- Multi-tenant phase 2, task 4: a `tenant` column on every store table, the four
-- global uniques swapped for tenant-scoped ones, alert_settings keyed by tenant.
--
-- Policies and every RPC except subscribe_newsletter are deliberately untouched
-- here (later tasks). 224 keeps working on its own after this file: each column
-- defaults to current_tenant(), which is '224clubhouse' for every existing
-- caller, and existing rows are backfilled to '224clubhouse'.

-- The CLI runs this file in one transaction. Every ALTER below needs an ACCESS
-- EXCLUSIVE lock; if a long storefront query holds the table, a blocked ALTER
-- would sit in the lock queue and every read behind it would queue too, taking
-- the store down. Fail fast instead: the push stops here and is simply re-run.
-- The CLI sends the file as one implicit transaction, so Postgres prints
-- "WARNING: SET LOCAL can only be used in transaction blocks"; the setting
-- still holds until the file commits (rehearsed locally: a held lock made the
-- next ALTER fail with 55P03 after the timeout, and nothing was recorded).
set local lock_timeout = '5s';

-- ---- 1. tenant column on the 19 tables of spec section 5.5 -------------------
-- Added with the literal '224clubhouse' as the default so the backfill is the
-- same constant for every row regardless of the session running the migration
-- (current_tenant() reads request GUCs). The default is then switched to
-- current_tenant() so new rows follow the caller's tenant. Constant default
-- + NOT NULL is a metadata-only change (no table rewrite), but the foreign key
-- is validated by scanning every existing row, under the ACCESS EXCLUSIVE lock
-- the ADD COLUMN holds until commit, and each index build scans the table
-- again. Both are fast at 224's row counts; lock_timeout above bounds the wait
-- to get the lock. Each table is ANALYZEd so the planner has stats for tenant
-- before the tenant-filtered policies (20261102130000) start using it.
do $$
declare
  t text;
begin
  foreach t in array array[
    'products', 'product_variants', 'product_reviews', 'events',
    'event_reservations', 'membership_tiers', 'memberships', 'orders',
    'discount_codes', 'newsletter_subscribers', 'contact_messages',
    'saved_carts', 'site_events', 'customer_profiles', 'customer_email_prefs',
    'drivers', 'driver_locations', 'admin_users', 'alert_settings'
  ] loop
    execute format(
      'alter table public.%I add column if not exists tenant text not null '
      'default %L references public.tenants(slug)', t, '224clubhouse');
    execute format(
      'alter table public.%I alter column tenant set default public.current_tenant()', t);
    -- Every table needs an index led by tenant. The four tables that get a
    -- tenant-scoped unique below, and alert_settings (tenant is its PK), are
    -- covered by those; the rest get a plain index.
    if t not in ('products', 'membership_tiers', 'discount_codes',
                 'newsletter_subscribers', 'alert_settings') then
      execute format(
        'create index if not exists %I on public.%I (tenant)', t || '_tenant_idx', t);
    end if;
    execute format('analyze public.%I', t);
  end loop;
end
$$;

-- ---- 2. tenant-scoped uniques: add the new ones BEFORE dropping the old ------
-- The old bundle only ever touches 224 rows, so nothing relies on global
-- uniqueness; keeping it would block a second store from reusing a slug, a
-- coupon code or a subscriber email.
alter table public.products
  add constraint products_tenant_slug_key unique (tenant, slug);
alter table public.membership_tiers
  add constraint membership_tiers_tenant_slug_key unique (tenant, slug);
alter table public.discount_codes
  add constraint discount_codes_tenant_code_key unique (tenant, code);
alter table public.newsletter_subscribers
  add constraint newsletter_subscribers_tenant_email_key unique (tenant, email);

alter table public.products drop constraint if exists products_slug_key;
alter table public.membership_tiers drop constraint if exists membership_tiers_slug_key;
alter table public.discount_codes drop constraint if exists discount_codes_code_key;
alter table public.newsletter_subscribers drop constraint if exists newsletter_subscribers_email_key;

-- ---- 3. alert_settings: one row per tenant, keyed by tenant -----------------
-- `id` stays (nullable, no default) so existing `where id = 1` readers still
-- parse and still find 224's row, which keeps id = 1. New tenants' rows have
-- id null. The id = 1 check and the primary key on id go; tenant is the key.
alter table public.alert_settings drop constraint if exists alert_settings_id_check;
alter table public.alert_settings drop constraint if exists alert_settings_pkey;
alter table public.alert_settings alter column id drop not null;
alter table public.alert_settings alter column id drop default;
alter table public.alert_settings add constraint alert_settings_pkey primary key (tenant);

-- ---- 4. subscribe_newsletter: tenant-scoped upsert --------------------------
-- Signature, grants and return shape unchanged. The old `on conflict (email)`
-- arbiter no longer exists once the global unique is dropped.
create or replace function public.subscribe_newsletter(
  p_email text,
  p_first_name text default null,
  p_last_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant text := public.current_tenant();
  v_email text := lower(trim(p_email));
  v_row newsletter_subscribers%rowtype;
begin
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'A valid email address is required';
  end if;
  if length(coalesce(p_first_name, '')) > 100 or length(coalesce(p_last_name, '')) > 100 then
    raise exception 'Name is too long';
  end if;

  insert into newsletter_subscribers (tenant, email, first_name, last_name)
  values (v_tenant, v_email, nullif(trim(coalesce(p_first_name, '')), ''), nullif(trim(coalesce(p_last_name, '')), ''))
  on conflict (tenant, email) do update
    set unsubscribed_at = null,
        -- Keep the details they just gave us; never blank an existing name
        -- because the re-subscribe form was left empty.
        first_name = coalesce(nullif(trim(coalesce(excluded.first_name, '')), ''), newsletter_subscribers.first_name),
        last_name  = coalesce(nullif(trim(coalesce(excluded.last_name, '')), ''), newsletter_subscribers.last_name)
  returning * into v_row;

  return jsonb_build_object('success', true, 'email', v_row.email);
end;
$$;
