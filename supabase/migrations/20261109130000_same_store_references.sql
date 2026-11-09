-- ============================================================
-- A row may only point at a row of its own store (2026-11-09)
-- ============================================================
-- Every store-owned table has a tenant column, but a foreign key only proves
-- the parent exists, not that it belongs to the same store. An Explosive 420
-- product option could hang off a 224 product, an order could be given another
-- store's driver, and so on (OPEN_ITEMS.md "must fix before a second store has
-- an admin"). RLS hides other stores' rows from normal reads, but the
-- SECURITY DEFINER RPCs and the service role do not go through it.
--
-- Two BEFORE INSERT/UPDATE triggers close that:
--   enforce_same_store_parent  — child.tenant must equal parent.tenant, for
--     every FK between two tenant tables (inventoried from the live schema):
--       product_variants.product_id   → products.id
--       product_reviews.product_id    → products.id
--       event_reservations.event_id   → events.id
--       memberships.tier_id           → membership_tiers.id
--       orders.driver_id              → drivers.user_id
--       driver_locations.driver_id    → drivers.user_id
--   enforce_same_store_account — a row that grants a login powers in a store
--     (admin_users, drivers) must be in the login's own store
--     (auth.users app_metadata.tenant, else 224 as in current_tenant()).
-- A null reference is allowed (the FK decides whether null is valid) and a
-- missing parent is left to the FK to report.
--
-- Triggers fire only when the reference or the tenant changes, so existing
-- rows are not re-checked; the report at the end lists any that already
-- disagree (expected: none).
-- ============================================================

create or replace function public.enforce_same_store_parent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- TG_ARGV: parent table, child FK column, parent key column (all uuid keys)
  v_ref text := to_jsonb(new) ->> tg_argv[1];
  v_parent_tenant text;
begin
  if v_ref is null then
    return new;
  end if;
  execute format('select tenant from public.%I where %I = $1::uuid', tg_argv[0], tg_argv[2])
     into v_parent_tenant
    using v_ref;
  if v_parent_tenant is not null and v_parent_tenant is distinct from new.tenant then
    raise exception '%.% points at a % row of another store', tg_table_name, tg_argv[1], tg_argv[0]
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_same_store_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- TG_ARGV: the column holding the auth.users id
  v_user uuid := (to_jsonb(new) ->> tg_argv[0])::uuid;
  v_account_tenant text;
begin
  select coalesce(nullif(raw_app_meta_data ->> 'tenant', ''), public.default_tenant())
    into v_account_tenant
    from auth.users where id = v_user;
  if found and v_account_tenant is distinct from new.tenant then
    raise exception '% row for a login of another store', tg_table_name
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function public.enforce_same_store_parent() from public, anon, authenticated;
revoke execute on function public.enforce_same_store_account() from public, anon, authenticated;

drop trigger if exists same_store_product on public.product_variants;
create trigger same_store_product before insert or update of product_id, tenant on public.product_variants
  for each row execute function public.enforce_same_store_parent('products', 'product_id', 'id');

drop trigger if exists same_store_product on public.product_reviews;
create trigger same_store_product before insert or update of product_id, tenant on public.product_reviews
  for each row execute function public.enforce_same_store_parent('products', 'product_id', 'id');

drop trigger if exists same_store_event on public.event_reservations;
create trigger same_store_event before insert or update of event_id, tenant on public.event_reservations
  for each row execute function public.enforce_same_store_parent('events', 'event_id', 'id');

drop trigger if exists same_store_tier on public.memberships;
create trigger same_store_tier before insert or update of tier_id, tenant on public.memberships
  for each row execute function public.enforce_same_store_parent('membership_tiers', 'tier_id', 'id');

drop trigger if exists same_store_driver on public.orders;
create trigger same_store_driver before insert or update of driver_id, tenant on public.orders
  for each row execute function public.enforce_same_store_parent('drivers', 'driver_id', 'user_id');

drop trigger if exists same_store_driver on public.driver_locations;
create trigger same_store_driver before insert or update of driver_id, tenant on public.driver_locations
  for each row execute function public.enforce_same_store_parent('drivers', 'driver_id', 'user_id');

drop trigger if exists same_store_account on public.admin_users;
create trigger same_store_account before insert or update of id, tenant on public.admin_users
  for each row execute function public.enforce_same_store_account('id');

drop trigger if exists same_store_account on public.drivers;
create trigger same_store_account before insert or update of user_id, tenant on public.drivers
  for each row execute function public.enforce_same_store_account('user_id');

-- Capability probe for the contract suite (same pattern as tenancy_applied()).
create or replace function public.same_store_references_applied()
returns boolean
language sql
immutable
set search_path = public
as $$ select true $$;

grant execute on function public.same_store_references_applied() to anon, authenticated;

-- Report rows that already disagree (does not fail the migration).
do $$
declare
  v_count bigint;
begin
  select
      (select count(*) from product_variants c join products p on p.id = c.product_id where c.tenant <> p.tenant)
    + (select count(*) from product_reviews c join products p on p.id = c.product_id where c.tenant <> p.tenant)
    + (select count(*) from event_reservations c join events p on p.id = c.event_id where c.tenant <> p.tenant)
    + (select count(*) from memberships c join membership_tiers p on p.id = c.tier_id where c.tenant <> p.tenant)
    + (select count(*) from orders c join drivers p on p.user_id = c.driver_id where c.tenant <> p.tenant)
    + (select count(*) from driver_locations c join drivers p on p.user_id = c.driver_id where c.tenant <> p.tenant)
    + (select count(*) from admin_users c join auth.users u on u.id = c.id
        where c.tenant <> coalesce(nullif(u.raw_app_meta_data ->> 'tenant', ''), public.default_tenant()))
    + (select count(*) from drivers c join auth.users u on u.id = c.user_id
        where c.tenant <> coalesce(nullif(u.raw_app_meta_data ->> 'tenant', ''), public.default_tenant()))
    into v_count;
  raise notice 'same-store references: % existing row(s) disagree', v_count;
end;
$$;
