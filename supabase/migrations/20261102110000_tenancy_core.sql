-- Multi-tenant phase 2, task 3: the tenants table and the helpers every later
-- policy and RPC builds on. Additive: nothing here changes how 224 behaves,
-- because with no JWT claim and no x-tenant header current_tenant() resolves
-- to '224clubhouse'.

-- ---- tenants ----------------------------------------------------------
create table if not exists public.tenants (
  slug         text primary key check (slug ~ '^[a-z0-9-]{2,40}$'),
  name         text not null,
  order_prefix text not null unique check (order_prefix ~ '^[A-Z0-9]{2,6}$'),
  min_age      int  not null check (min_age between 18 and 25),
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- Explicit: live has an auto-enable event trigger, a fresh local stack does not.
alter table public.tenants enable row level security;

-- The catalogue of stores is not secret (anon needs min_age / order_prefix via
-- the helpers below). No write policy: only the service role writes.
drop policy if exists tenants_public_select on public.tenants;
create policy tenants_public_select on public.tenants
  for select using (true);

insert into public.tenants (slug, name, order_prefix, min_age, active)
values ('224clubhouse', '224 Clubhouse', '224', 21, true)
on conflict (slug) do nothing;

-- ---- helpers ----------------------------------------------------------
create or replace function public.default_tenant()
returns text
language sql
stable
set search_path = public
as $$ select '224clubhouse'::text $$;

-- Signed-in users: the JWT claim is authoritative and cannot be overridden by
-- a header. Anonymous: the x-tenant header picks the store (anon can only read
-- public data, so a forged header reveals nothing private). Otherwise 224.
-- request.headers is unset/empty outside PostgREST (psql, cron, triggers), and
-- ''::json is an error, so it is nullif'd before the cast.
create or replace function public.current_tenant()
returns text
language sql
stable
set search_path = public
as $$
  select coalesce(
    auth.jwt() -> 'app_metadata' ->> 'tenant',
    nullif(nullif(current_setting('request.headers', true), '')::json ->> 'x-tenant', ''),
    public.default_tenant()
  )
$$;

create or replace function public.tenant_min_age()
returns int
language sql
stable
set search_path = public
as $$ select min_age from public.tenants where slug = public.current_tenant() $$;

create or replace function public.tenant_order_prefix()
returns text
language sql
stable
set search_path = public
as $$ select order_prefix from public.tenants where slug = public.current_tenant() $$;

revoke execute on function public.default_tenant(), public.current_tenant(),
  public.tenant_min_age(), public.tenant_order_prefix() from public;
grant execute on function public.default_tenant(), public.current_tenant(),
  public.tenant_min_age(), public.tenant_order_prefix() to anon, authenticated;

-- ---- Capability probe -------------------------------------------------
create or replace function tenancy_applied()
returns boolean
language sql
immutable
set search_path = public
as $$ select true $$;

grant execute on function tenancy_applied() to anon, authenticated;
