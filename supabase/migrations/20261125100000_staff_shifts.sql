-- E420 in-store system, part 1: staff accounts and selfie shift clock-in
-- (spec: docs/superpowers/specs/2026-11-24-e420-in-store-design.md,
--  plan: docs/superpowers/plans/2026-11-25-staff-shifts.md).
--
-- Staff are the accounts the shared counter tablet signs in with: they can
-- clock in/out (and, in later parts, ring up sales), never reach admin pages.
-- is_staff() is also true for the store's admins, who may run the counter.
--
-- Every write goes through a SECURITY DEFINER function: shift times are the
-- server's clock, and one person has at most one open shift per store.
-- Selfies live in the private bucket shift-selfies under <tenant>/<uid>/.

-- ---- staff_members -----------------------------------------------------------
create table if not exists public.staff_members (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  tenant     text not null default public.current_tenant() references public.tenants(slug),
  full_name  text not null check (length(trim(full_name)) between 1 and 80),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.staff_members enable row level security;

drop policy if exists staff_members_admin_all on public.staff_members;
create policy staff_members_admin_all on public.staff_members for all
  using (public.is_admin() and tenant = (select public.current_tenant()))
  with check (public.is_admin() and tenant = (select public.current_tenant()));

drop policy if exists staff_members_self_select on public.staff_members;
create policy staff_members_self_select on public.staff_members for select
  using ((select auth.uid()) = user_id and tenant = (select public.current_tenant()));

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from staff_members
     where user_id = auth.uid()
       and active
       and tenant = public.current_tenant()
  ) or public.is_admin();
$$;
revoke execute on function public.is_staff() from public;
grant execute on function public.is_staff() to anon, authenticated;

-- ---- shifts ------------------------------------------------------------------
create table if not exists public.shifts (
  id          uuid primary key default gen_random_uuid(),
  tenant      text not null default public.current_tenant() references public.tenants(slug),
  user_id     uuid not null references auth.users(id) on delete cascade,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  selfie_path text not null check (length(selfie_path) <= 300),
  created_at  timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);
alter table public.shifts enable row level security;

create unique index if not exists shifts_one_open_per_person
  on public.shifts (user_id, tenant) where ended_at is null;
create index if not exists shifts_tenant_started_idx
  on public.shifts (tenant, started_at desc);

-- Reads only; every write is one of the functions below.
drop policy if exists shifts_select on public.shifts;
create policy shifts_select on public.shifts for select
  using (
    tenant = (select public.current_tenant())
    and ((select auth.uid()) = user_id or public.is_admin())
  );

-- ---- admin: add / (de)activate staff ------------------------------------------
-- By email of an existing account in THIS store (one login belongs to one
-- store; accounts from before stores existed carry no claim and are 224's).
create or replace function public.admin_add_staff(p_email text, p_full_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant text := public.current_tenant();
  v_uid    uuid;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;
  if coalesce(trim(p_full_name), '') = '' or length(trim(p_full_name)) > 80 then
    raise exception 'Please enter a name (up to 80 characters)';
  end if;

  select u.id into v_uid
    from auth.users u
   where lower(u.email) = lower(trim(p_email))
     and coalesce(u.raw_app_meta_data->>'tenant', u.raw_user_meta_data->>'tenant',
                  public.default_tenant()) = v_tenant
   limit 1;
  if v_uid is null then
    raise exception 'No account with that email in this store — ask them to sign up first';
  end if;

  insert into staff_members (user_id, tenant, full_name, active)
  values (v_uid, v_tenant, trim(p_full_name), true)
  on conflict (user_id) do update
    set full_name = excluded.full_name, active = true
    where staff_members.tenant = v_tenant;
  if not found then
    raise exception 'No account with that email in this store — ask them to sign up first';
  end if;
  return v_uid;
end;
$$;

create or replace function public.admin_set_staff_active(p_user_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;
  update staff_members set active = coalesce(p_active, false)
   where user_id = p_user_id and tenant = public.current_tenant();
  if not found then
    raise exception 'Staff member not found';
  end if;
  -- A disabled person can't reach the counter to clock out: close it for them.
  if not coalesce(p_active, false) then
    update shifts set ended_at = now()
     where user_id = p_user_id and tenant = public.current_tenant() and ended_at is null;
  end if;
end;
$$;

-- ---- shifts: start / end / current ---------------------------------------------
create or replace function public.start_shift(p_selfie_path text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_tenant text := public.current_tenant();
  v_row    shifts%rowtype;
begin
  if v_uid is null or not public.is_staff() then
    raise exception 'Not authorized';
  end if;
  -- The selfie must be in the caller's own folder of this store.
  if p_selfie_path is null
     or split_part(p_selfie_path, '/', 1) <> v_tenant
     or split_part(p_selfie_path, '/', 2) <> v_uid::text
     or split_part(p_selfie_path, '/', 3) = ''
     or split_part(p_selfie_path, '/', 4) <> '' then
    raise exception 'Invalid selfie path';
  end if;
  if exists (select 1 from shifts where user_id = v_uid and tenant = v_tenant and ended_at is null) then
    raise exception 'Shift already started';
  end if;

  insert into shifts (tenant, user_id, selfie_path)
  values (v_tenant, v_uid, p_selfie_path)
  returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'started_at', v_row.started_at);
exception when unique_violation then
  -- Two taps at once: the partial unique index lets only one through.
  raise exception 'Shift already started';
end;
$$;

create or replace function public.end_shift()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row shifts%rowtype;
begin
  update shifts set ended_at = now()
   where user_id = auth.uid() and tenant = public.current_tenant() and ended_at is null
  returning * into v_row;
  if not found then
    raise exception 'No open shift';
  end if;
  return jsonb_build_object('id', v_row.id, 'started_at', v_row.started_at, 'ended_at', v_row.ended_at);
end;
$$;

create or replace function public.my_open_shift()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('id', id, 'started_at', started_at, 'selfie_path', selfie_path)
    from shifts
   where user_id = auth.uid() and tenant = public.current_tenant() and ended_at is null
   limit 1;
$$;

-- Admin closes someone's shift (forgot to clock out, left early).
create or replace function public.admin_end_shift(p_shift_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row shifts%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;
  update shifts set ended_at = now()
   where id = p_shift_id and tenant = public.current_tenant() and ended_at is null
  returning * into v_row;
  if not found then
    raise exception 'No open shift';
  end if;
  return jsonb_build_object('id', v_row.id, 'started_at', v_row.started_at, 'ended_at', v_row.ended_at);
end;
$$;
revoke execute on function public.admin_end_shift(uuid) from public, anon;
grant execute on function public.admin_end_shift(uuid) to authenticated;

revoke execute on function public.admin_add_staff(text, text), public.admin_set_staff_active(uuid, boolean),
  public.start_shift(text), public.end_shift(), public.my_open_shift() from public, anon;
grant execute on function public.admin_add_staff(text, text), public.admin_set_staff_active(uuid, boolean),
  public.start_shift(text), public.end_shift(), public.my_open_shift() to authenticated;

-- ---- storage: private selfie bucket ---------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'shift-selfies', 'shift-selfies', false, 3145728,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Path layout: <tenant>/<uid>/<file>. Compared as text.
drop policy if exists shift_selfies_staff_insert on storage.objects;
create policy shift_selfies_staff_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'shift-selfies'
    and (storage.foldername(name))[1] = (select public.current_tenant())
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and public.is_staff()
  );

drop policy if exists shift_selfies_select on storage.objects;
create policy shift_selfies_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'shift-selfies'
    and (storage.foldername(name))[1] = (select public.current_tenant())
    and ((storage.foldername(name))[2] = (select auth.uid())::text or public.is_admin())
  );

drop policy if exists shift_selfies_admin_delete on storage.objects;
create policy shift_selfies_admin_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'shift-selfies'
    and (storage.foldername(name))[1] = (select public.current_tenant())
    and public.is_admin()
  );

-- ---- selfie retention (POPIA) ---------------------------------------------------
-- Selfies are kept 90 days. Uploads no shift points to (a refused or retried
-- start) are removed after a day. Storage forbids deleting rows from
-- storage.objects directly, so this only LISTS them; the purge-shift-selfies
-- Edge Function (service role, daily cron below) removes them through the
-- Storage API, calling once per store with that store's x-tenant.
create or replace function public.shift_selfies_to_purge(
  p_orphan_after interval default interval '1 day',
  p_keep interval default interval '90 days'
)
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select o.name
    from storage.objects o
   where o.bucket_id = 'shift-selfies'
     and split_part(o.name, '/', 1) = public.current_tenant()
     and (
       o.created_at < now() - p_keep
       or (o.created_at < now() - p_orphan_after
           and not exists (select 1 from shifts s
                            where s.selfie_path = o.name and s.tenant = public.current_tenant()))
     )
   order by o.created_at
   limit 1000;
$$;
revoke execute on function public.shift_selfies_to_purge(interval, interval) from public, anon, authenticated;
grant execute on function public.shift_selfies_to_purge(interval, interval) to service_role;

-- Daily at 01:10 UTC (03:10 in South Africa).
select cron.unschedule(jobid) from cron.job where jobname = 'purge-shift-selfies';
select cron.schedule(
  'purge-shift-selfies',
  '10 1 * * *',
  $cron$
  select net.http_post(
    url := 'https://aogdkqczvlffgydgxsmz.supabase.co/functions/v1/purge-shift-selfies',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                         where name = 'cart_reminders_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $cron$
);
