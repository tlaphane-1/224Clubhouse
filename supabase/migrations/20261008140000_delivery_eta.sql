-- ============================================================
-- 224 Clubhouse — delivery destination, distance/ETA, "driver nearby" (2026-10-08)
-- ============================================================
-- * orders gain the delivery address as a map point (dest_lat/dest_lng),
--   written by the geocode-order Edge Function (service role) when the driver
--   starts the delivery. Geocoding is best-effort: no point = no ETA, nothing
--   else changes.
-- * distance_m(): great-circle (haversine) metres between two points. Pure
--   maths, so callable by anyone.
-- * driver_update_location now RETURNS jsonb {stored, nearby}. `nearby` lists
--   the driver's out-for-delivery orders that just came within 1 km of their
--   destination; each order is reported once (nearby_notified_at), and the
--   driver's browser then asks send-status-email to send the "driver nearby"
--   email. The return type changes, so the old function is dropped first.
-- * get_delivery_location also returns the destination and the remaining
--   straight-line distance.
-- ============================================================

alter table orders add column if not exists dest_lat double precision
  check (dest_lat is null or dest_lat between -90 and 90);
alter table orders add column if not exists dest_lng double precision
  check (dest_lng is null or dest_lng between -180 and 180);
alter table orders add column if not exists geocoded_at timestamptz;
alter table orders add column if not exists nearby_notified_at timestamptz;

create or replace function distance_m(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
)
returns double precision
language sql
immutable
set search_path = public
as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ));
$$;

grant execute on function distance_m(double precision, double precision, double precision, double precision)
  to anon, authenticated;

-- ---- driver_update_location: boolean -> jsonb {stored, nearby} ----------
-- Body is 20261007150000 verbatim plus the NEARBY block.
drop function if exists driver_update_location(double precision, double precision, real, real, real);

create or replace function driver_update_location(
  p_lat double precision,
  p_lng double precision,
  p_accuracy real default null,
  p_heading real default null,
  p_speed real default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_nearby uuid[];
begin
  if not is_driver() then raise exception 'Not authorized'; end if;
  if not exists (
    select 1 from orders where driver_id = v_uid and status = 'out_for_delivery'
  ) then
    delete from driver_locations where driver_id = v_uid;
    return jsonb_build_object('stored', false, 'nearby', '[]'::jsonb);
  end if;
  insert into driver_locations (driver_id, lat, lng, accuracy_m, heading, speed_mps, updated_at)
  values (v_uid, p_lat, p_lng, p_accuracy, p_heading, p_speed, now())
  on conflict (driver_id) do update
     set lat = excluded.lat, lng = excluded.lng, accuracy_m = excluded.accuracy_m,
         heading = excluded.heading, speed_mps = excluded.speed_mps, updated_at = now();

  -- NEARBY: orders that just came within 1 km, each reported once.
  with hit as (
    update orders o
       set nearby_notified_at = now()
     where o.driver_id = v_uid
       and o.status = 'out_for_delivery'
       and o.nearby_notified_at is null
       and o.dest_lat is not null and o.dest_lng is not null
       and distance_m(p_lat, p_lng, o.dest_lat, o.dest_lng) <= 1000
    returning o.id
  )
  select array_agg(id) into v_nearby from hit;

  return jsonb_build_object(
    'stored', true,
    'nearby', coalesce(to_jsonb(v_nearby), '[]'::jsonb)
  );
end;
$$;

revoke execute on function driver_update_location(double precision, double precision, real, real, real) from public, anon;
grant  execute on function driver_update_location(double precision, double precision, real, real, real) to authenticated;

-- ---- get_delivery_location: + destination and remaining distance --------
-- Body is 20261007150000 verbatim plus dest_lat / dest_lng / distance_m.
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
    'delivery_started_at', o.delivery_started_at,
    'dest_lat', o.dest_lat,
    'dest_lng', o.dest_lng,
    'distance_m', case when o.dest_lat is not null and o.dest_lng is not null
                       then round(distance_m(l.lat, l.lng, o.dest_lat, o.dest_lng)) end
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
