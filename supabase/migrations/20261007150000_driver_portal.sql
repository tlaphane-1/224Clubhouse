-- ============================================================
-- 224 Clubhouse — driver portal + live delivery tracking (2026-10-07)
-- ============================================================
-- * drivers: accounts the admin creates (the admin-create-driver Edge
--   Function creates the auth user and this row together).
-- * orders.driver_id: the admin assigns each order to a driver. A driver can
--   read ONLY the orders assigned to them (RLS), and moves them
--   out_for_delivery -> delivered through driver_* RPCs.
-- * driver_locations: ONE row per driver — the latest position only, no
--   history. Written only while the driver has an order out for delivery;
--   deleted when their last delivery is completed, and swept daily.
-- * Customers see the location of the driver carrying THEIR order, only while
--   it is out for delivery (get_delivery_location: order number + email, the
--   same two factors /track already uses). Admins see all active drivers.
-- ============================================================

create table if not exists drivers (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null check (length(trim(full_name)) between 1 and 80),
  phone       text check (length(phone) <= 30),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table drivers enable row level security;

drop policy if exists "drivers_admin_all" on drivers;
create policy "drivers_admin_all" on drivers
  for all using (is_admin()) with check (is_admin());
drop policy if exists "drivers_self_select" on drivers;
create policy "drivers_self_select" on drivers
  for select using ((select auth.uid()) = user_id);

-- Mirrors is_admin(): SECURITY DEFINER so policies can call it without
-- recursing through drivers' own RLS.
create or replace function is_driver()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from drivers where user_id = auth.uid() and active
  );
$$;

grant execute on function is_driver() to anon, authenticated;

alter table orders add column if not exists driver_id uuid references drivers(user_id) on delete set null;
alter table orders add column if not exists delivery_started_at timestamptz;
create index if not exists orders_driver_id_idx on orders (driver_id) where driver_id is not null;

-- A driver reads their assigned orders (address, phone, items, amount to
-- collect). No write policy: status moves go through the RPCs below.
drop policy if exists "orders_driver_select" on orders;
create policy "orders_driver_select" on orders
  for select using (driver_id = (select auth.uid()) and is_driver());

create table if not exists driver_locations (
  driver_id   uuid primary key references drivers(user_id) on delete cascade,
  lat         double precision not null check (lat between -90 and 90),
  lng         double precision not null check (lng between -180 and 180),
  accuracy_m  real,
  heading     real,
  speed_mps   real,
  updated_at  timestamptz not null default now()
);

alter table driver_locations enable row level security;
-- No policies: read and write only through the functions below.

-- ---- Admin ----------------------------------------------------------
create or replace function admin_assign_driver(p_order_id uuid, p_driver_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then raise exception 'Not authorized'; end if;
  if p_driver_id is not null and not exists (
    select 1 from drivers where user_id = p_driver_id and active
  ) then
    raise exception 'Driver not found or inactive';
  end if;
  update orders set driver_id = p_driver_id where id = p_order_id;
  if not found then raise exception 'Order not found'; end if;
end;
$$;

revoke execute on function admin_assign_driver(uuid, uuid) from public, anon;
grant  execute on function admin_assign_driver(uuid, uuid) to authenticated;

-- Every driver with a fresh position (last 15 min) and what they're carrying.
create or replace function admin_driver_locations()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_admin() then raise exception 'Not authorized'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'driver_id', d.user_id, 'name', d.full_name, 'phone', d.phone,
      'lat', l.lat, 'lng', l.lng, 'accuracy_m', l.accuracy_m, 'updated_at', l.updated_at,
      'orders', coalesce((
        select jsonb_agg(o.order_number order by o.delivery_started_at)
          from orders o where o.driver_id = d.user_id and o.status = 'out_for_delivery'
      ), '[]'::jsonb)
    ) order by d.full_name)
      from drivers d
      join driver_locations l on l.driver_id = d.user_id
     where l.updated_at > now() - interval '15 minutes'
  ), '[]'::jsonb);
end;
$$;

revoke execute on function admin_driver_locations() from public, anon;
grant  execute on function admin_driver_locations() to authenticated;

-- ---- Driver ---------------------------------------------------------
create or replace function driver_start_delivery(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row orders%rowtype;
begin
  if not is_driver() then raise exception 'Not authorized'; end if;
  select * into v_row from orders where id = p_order_id for update;
  if not found or v_row.driver_id is distinct from v_uid then
    raise exception 'Order not found';
  end if;
  if v_row.status = 'out_for_delivery' then
    return jsonb_build_object('status', v_row.status);
  end if;
  if v_row.status not in ('pending', 'confirmed', 'preparing') then
    raise exception 'This order is %', v_row.status;
  end if;
  -- Same rule as admin_update_order_status: unpaid EFT doesn't leave.
  if v_row.payment_method = 'eft' and v_row.paid_at is null then
    raise exception 'EFT payment not confirmed yet — ask the club to confirm it first';
  end if;

  update orders
     set status = 'out_for_delivery',
         delivery_started_at = now(),
         status_history = coalesce(status_history, '[]'::jsonb)
           || jsonb_build_object('status', 'out_for_delivery', 'at', now(), 'actor', v_uid)
   where id = p_order_id;
  return jsonb_build_object('status', 'out_for_delivery');
end;
$$;

revoke execute on function driver_start_delivery(uuid) from public, anon;
grant  execute on function driver_start_delivery(uuid) to authenticated;

create or replace function driver_complete_delivery(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row orders%rowtype;
begin
  if not is_driver() then raise exception 'Not authorized'; end if;
  select * into v_row from orders where id = p_order_id for update;
  if not found or v_row.driver_id is distinct from v_uid then
    raise exception 'Order not found';
  end if;
  if v_row.status = 'delivered' then
    return jsonb_build_object('status', v_row.status);
  end if;
  if v_row.status <> 'out_for_delivery' then
    raise exception 'Start the delivery first';
  end if;

  update orders
     set status = 'delivered',
         status_history = coalesce(status_history, '[]'::jsonb)
           || jsonb_build_object('status', 'delivered', 'at', now(), 'actor', v_uid)
   where id = p_order_id;

  -- Last delivery done: stop keeping this driver's position.
  if not exists (
    select 1 from orders where driver_id = v_uid and status = 'out_for_delivery'
  ) then
    delete from driver_locations where driver_id = v_uid;
  end if;
  return jsonb_build_object('status', 'delivered');
end;
$$;

revoke execute on function driver_complete_delivery(uuid) from public, anon;
grant  execute on function driver_complete_delivery(uuid) to authenticated;

-- Stores the driver's latest position — but only while they are actually
-- carrying an order. Returns whether it was stored.
create or replace function driver_update_location(
  p_lat double precision,
  p_lng double precision,
  p_accuracy real default null,
  p_heading real default null,
  p_speed real default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not is_driver() then raise exception 'Not authorized'; end if;
  if not exists (
    select 1 from orders where driver_id = v_uid and status = 'out_for_delivery'
  ) then
    delete from driver_locations where driver_id = v_uid;
    return false;
  end if;
  insert into driver_locations (driver_id, lat, lng, accuracy_m, heading, speed_mps, updated_at)
  values (v_uid, p_lat, p_lng, p_accuracy, p_heading, p_speed, now())
  on conflict (driver_id) do update
     set lat = excluded.lat, lng = excluded.lng, accuracy_m = excluded.accuracy_m,
         heading = excluded.heading, speed_mps = excluded.speed_mps, updated_at = now();
  return true;
end;
$$;

revoke execute on function driver_update_location(double precision, double precision, real, real, real) from public, anon;
grant  execute on function driver_update_location(double precision, double precision, real, real, real) to authenticated;

-- ---- Customer -------------------------------------------------------
-- Live position of the driver carrying this order, while it is out for
-- delivery. Same two factors as get_order_tracking (order number + the email
-- it was placed with), so it works on /track signed out as well as on the
-- signed-in order page. Returns null when there is nothing to show.
create or replace function get_delivery_location(p_order_number text, p_email text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'driver_first_name', split_part(d.full_name, ' ', 1),
    'lat', l.lat, 'lng', l.lng, 'accuracy_m', l.accuracy_m,
    'updated_at', l.updated_at,
    'delivery_started_at', o.delivery_started_at
  )
  from orders o
  join drivers d on d.user_id = o.driver_id
  join driver_locations l on l.driver_id = o.driver_id
  where o.order_number = upper(trim(p_order_number))
    and lower(o.customer_email) = lower(trim(p_email))
    and o.status = 'out_for_delivery'
  limit 1;
$$;

grant execute on function get_delivery_location(text, text) to anon, authenticated;

-- Stale positions (a driver who closed the app mid-delivery) are swept daily.
select cron.unschedule(jobid) from cron.job where jobname = 'purge-driver-locations';
select cron.schedule(
  'purge-driver-locations',
  '55 2 * * *',
  $cron$ delete from public.driver_locations where updated_at < now() - interval '1 day'; $cron$
);
