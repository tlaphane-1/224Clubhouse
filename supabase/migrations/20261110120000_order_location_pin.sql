-- Customer's location pin on a delivery order (2026-11-10).
--
-- At checkout a customer may tap "Use my current location". The phone's
-- position is saved on the order so the club can check the typed address
-- against where the customer actually was, and the driver can navigate to the
-- exact spot. Optional: an order without a pin is still a valid order.
--
-- The pin is attached by set_order_pin right after place_cod_order returns,
-- rather than by changing place_cod_order itself: that function is the
-- money/stock boundary and stays exactly as it is. set_order_pin can only touch
-- the caller's own order in their own store, once, while it is still pending
-- and at most 15 minutes old, so it cannot be used to move a pin later.
--
-- POPIA: a precise location is personal information. The daily sweep below
-- clears the pin (and the map point geocode-order copied from it) 30 days
-- after the order was placed, once it is delivered or cancelled (the privacy
-- policy says so).

alter table public.orders
  add column if not exists pin_lat        double precision,
  add column if not exists pin_lng        double precision,
  add column if not exists pin_accuracy_m integer,
  add column if not exists pin_at         timestamptz;

alter table public.orders drop constraint if exists orders_pin_valid;
alter table public.orders add constraint orders_pin_valid check (
  (pin_lat is null and pin_lng is null and pin_accuracy_m is null and pin_at is null)
  or (pin_lat between -90 and 90 and pin_lng between -180 and 180 and pin_at is not null
      and (pin_accuracy_m is null or pin_accuracy_m between 0 and 100000))
);

create or replace function public.set_order_pin(
  p_order_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_accuracy_m integer default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_tenant text := public.current_tenant();
begin
  if v_uid is null then
    raise exception 'Sign in required';
  end if;
  if p_lat is null or p_lng is null
     or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'Invalid location';
  end if;

  update orders
     set pin_lat = p_lat,
         pin_lng = p_lng,
         pin_accuracy_m = case when p_accuracy_m is null then null
                               else least(greatest(p_accuracy_m, 0), 100000) end,
         pin_at = now()
   where id = p_order_id
     and user_id = v_uid
     and tenant = v_tenant
     and status = 'pending'
     and pin_at is null
     and created_at > now() - interval '15 minutes';

  -- One message for every refusal: no hint whether someone else's order exists.
  if not found then
    raise exception 'Order not found';
  end if;
end;
$$;

revoke all on function public.set_order_pin(uuid, double precision, double precision, integer) from public, anon;
grant execute on function public.set_order_pin(uuid, double precision, double precision, integer) to authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'purge-order-pins';
select cron.schedule(
  'purge-order-pins',
  '50 2 * * *',
  $cron$
    update public.orders
       set pin_lat = null, pin_lng = null, pin_accuracy_m = null, pin_at = null,
           -- geocode-order copies the pin into dest_* for the live map.
           dest_lat = null, dest_lng = null
     where pin_at is not null
       and status in ('delivered', 'cancelled')
       and created_at < now() - interval '30 days';
  $cron$
);
