-- Collect-only fulfilment (spec: docs/superpowers/specs/2026-11-24-collect-only-fulfilment-design.md).
--
-- A store is either 'delivery' (address, fee, drivers — 224) or 'collect'
-- (order online, collect at the club — Explosive 420). The column is the
-- server's source of truth; tenants/<slug>/tenant.json delivery.mode must agree
-- (src/__tests__/fulfilmentDrift.unit.test.js reads the update below).
--
-- Order statuses and payment methods are unchanged (approach A): in a collect
-- store the UI labels out_for_delivery "Ready for Collection" and delivered
-- "Collected".
--
-- Changes, nothing else:
--   1. tenants.fulfilment + tenant_fulfilment() helper.
--   2. place_cod_order: copied verbatim from 20261102140000 with exactly two
--      changes in a collect store — shipping fee 0, shipping_address '{}'.
--   3. set_order_pin: refuses in a collect store.
--   4. is_driver(): false in a collect store, which blocks
--      driver_start_delivery / driver_complete_delivery /
--      driver_update_location and every driver policy without editing them.
-- create or replace keeps each function's existing grants.

-- ---- 1. column + helper -----------------------------------------------------
alter table public.tenants add column if not exists fulfilment text not null default 'delivery';
alter table public.tenants drop constraint if exists tenants_fulfilment_check;
alter table public.tenants add constraint tenants_fulfilment_check
  check (fulfilment in ('delivery', 'collect'));

update public.tenants set fulfilment = 'collect' where slug = 'explosive420';

-- A store with no tenants row is treated as 'delivery' (today's behaviour);
-- place_cod_order already refuses an unknown store.
create or replace function public.tenant_fulfilment()
returns text
language sql
stable
set search_path = public
as $$
  select coalesce(
    (select fulfilment from public.tenants where slug = public.current_tenant()),
    'delivery'
  )
$$;

revoke execute on function public.tenant_fulfilment() from public;
grant execute on function public.tenant_fulfilment() to anon, authenticated;

-- ---- 2. place_cod_order -----------------------------------------------------
create or replace function public.place_cod_order(p_customer jsonb, p_items jsonb, p_payment_method text, p_discount_code text DEFAULT NULL::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path = public
as $function$
declare
  v_uid        uuid := auth.uid();
  v_tenant     text := public.current_tenant();
  v_min_age    int  := public.tenant_min_age();
  v_prefix     text := public.tenant_order_prefix();
  v_email      text;
  v_item       jsonb;
  v_prod       products%rowtype;
  v_var        product_variants%rowtype;
  v_var_id     uuid;
  v_price      int;
  v_qty        int;
  v_items      jsonb := '[]'::jsonb;
  v_subtotal   int := 0;
  v_shipping   int;
  v_total      int;
  v_number     text;
  v_id         uuid;
  v_code_in    text := nullif(trim(coalesce(p_discount_code, '')), '');
  v_eval       jsonb;
  v_disc_code  text := null;
  v_disc_cents int := 0;
  v_is_member  boolean;
  -- COLLECT (20261124120000): order online, collect at the club.
  v_collect    boolean := public.tenant_fulfilment() = 'collect';
begin
  if v_uid is null then
    raise exception 'Sign in required to place an order';
  end if;

  -- TENANT (20261102140000): fail closed on a store with no tenants row.
  if v_min_age is null or v_prefix is null then
    raise exception 'Unknown store';
  end if;

  -- THE ONE ADDITION over 20260814103000. Serialises this account's concurrent
  -- checkouts for the rest of the transaction; released automatically on
  -- commit or rollback. Taken here so the lock order is always
  -- account -> products -> discount_codes (see the header note).
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));

  select email into v_email from auth.users where id = v_uid;
  if coalesce(trim(v_email), '') = '' then
    raise exception 'Account has no email address';
  end if;

  -- AGE CHECK (20261008120000): a date of birth at least the store's minimum
  -- age (tenant_min_age(), 21 for 224) must be on record in this store.
  if not exists (
    select 1 from customer_profiles
     where user_id = v_uid
       and tenant = v_tenant
       and date_of_birth <= (current_date - make_interval(years => v_min_age))::date
  ) then
    raise exception 'Age check: please confirm your date of birth before ordering';
  end if;

  if p_payment_method not in ('cash_on_delivery','card_on_delivery','eft') then
    raise exception 'Invalid payment method';
  end if;
  -- MEMBERSHIP REQUIRED AFTER THE FIRST ORDER. "Applied" is enough (pending
  -- or active-unexpired) — admins approve once payment is received. Race-free
  -- under the advisory lock above. The message is prefixed so the frontend
  -- can recognise it and show the become-a-member prompt.
  -- Both sides count only this store's orders and memberships.
  if exists (
    select 1 from orders o
     where o.user_id = v_uid and o.tenant = v_tenant and o.status <> 'cancelled'
  ) and not exists (
    select 1 from memberships m
     where m.user_id = v_uid
       and m.tenant = v_tenant
       and (m.status = 'pending'
            or (m.status = 'active' and m.expires_at > now()))
  ) then
    raise exception 'Membership required: please apply for membership to place another order';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'No items in order';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'Too many items in order';
  end if;
  if coalesce(trim(p_customer->>'name'), '') = ''
     or coalesce(trim(p_customer->>'phone'), '') = '' then
    raise exception 'Missing customer details';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_item->>'quantity')::int, 0);
    if v_qty < 1 or v_qty > 100 then
      raise exception 'Invalid quantity';
    end if;
    -- lock the product row so concurrent orders can't both pass the stock check
    -- Another store's product id is "not found", exactly like a missing one.
    select * into v_prod from products
     where id = (v_item->>'id')::uuid and tenant = v_tenant
     for update;
    if not found then raise exception 'Product not found'; end if;
    if not v_prod.is_available then raise exception 'Product "%" is unavailable', v_prod.name; end if;
    -- VARIANTS (20261005140000). A product with options must be bought as one
    -- of them: price and stock come from the variant row, locked AFTER its
    -- product (lock order product -> variant -> discount_codes everywhere).
    v_var_id := nullif(v_item->>'variant_id', '')::uuid;
    if v_var_id is not null then
      select * into v_var from product_variants
       where id = v_var_id and product_id = v_prod.id and tenant = v_tenant
       for update;
      if not found then raise exception 'Option not found for "%"', v_prod.name; end if;
      if not v_var.is_available then
        raise exception 'Product "% — %" is unavailable', v_prod.name, v_var.label;
      end if;
      if v_var.stock_quantity < v_qty then
        raise exception 'Insufficient stock for "% — %"', v_prod.name, v_var.label;
      end if;
      v_price := v_var.price;
    else
      if exists (
        select 1 from product_variants where product_id = v_prod.id and tenant = v_tenant
      ) then
        raise exception 'Please choose an option for "%"', v_prod.name;
      end if;
      if v_prod.stock_quantity < v_qty then raise exception 'Insufficient stock for "%"', v_prod.name; end if;
      v_price := v_prod.price;
    end if;
    -- MEMBER-ONLY GATE (from 20260813150000 — unchanged)
    if v_prod.is_member_only and not exists (
      select 1 from memberships m
       where m.user_id = v_uid
         and m.tenant = v_tenant
         and m.status = 'active'
         and m.expires_at > now()
    ) then
      raise exception 'Product "%" is for members only', v_prod.name;
    end if;
    v_subtotal := v_subtotal + v_price * v_qty;
    -- jsonb_build_array: `array || object` would append, but being explicit
    -- keeps the variant fields inside the line object.
    v_items := v_items || jsonb_build_array(
      jsonb_build_object(
        'id', v_prod.id, 'name', v_prod.name, 'price', v_price,
        'quantity', v_qty, 'slug', v_prod.slug
      ) || case when v_var_id is null then '{}'::jsonb
                else jsonb_build_object('variant_id', v_var.id, 'variant_label', v_var.label) end
    );
  end loop;

  -- DISCOUNT (the one addition over 20260813150000).
  -- The client sends a CODE and nothing else. The value is re-derived here by
  -- discount_eval against v_subtotal, which was just computed from locked DB
  -- product rows — a client that lies about the amount has nothing to lie
  -- with. Re-validating (rather than trusting the earlier
  -- validate_discount_code preview) is what closes the gap where a code
  -- expires, runs out, or stops being the caller's first order between the
  -- Apply click and the Place Order click. Its first_order_only test is now
  -- also race-free: the advisory lock above means no other checkout for this
  -- account can be between its own check and its own commit.
  -- discount_eval scopes itself to current_tenant(), the same store as here.
  if v_code_in is not null then
    v_eval := discount_eval(v_code_in, v_subtotal, v_uid);
    if not coalesce((v_eval->>'valid')::boolean, false) then
      -- Prefixed so the frontend can recognise a discount rejection and clear
      -- the applied code instead of showing a bare database error.
      raise exception 'Discount code: %', v_eval->>'reason';
    end if;
    v_disc_code  := v_eval->>'code';
    v_disc_cents := (v_eval->>'discount_cents')::int;
    -- Clamp again at the point of use: even if a future edit to discount_eval
    -- loosened its own clamp, the total here can never go below zero.
    v_disc_cents := least(greatest(v_disc_cents, 0), v_subtotal);
  end if;

  -- FREE SHIPPING IS DECIDED ON THE **PRE-DISCOUNT** SUBTOTAL. Deliberate:
  -- if the threshold used the discounted figure, a customer with a R520 cart
  -- (free shipping) who applied WELCOME10 would drop to R468, lose free
  -- shipping, and have R80 added back — a "discount" that makes the order
  -- R28 MORE expensive than not using it. The threshold measures what the
  -- customer chose to buy; the discount is a reduction applied after that
  -- decision, so it can never silently take free shipping away.
  -- Members (active, unexpired) always get free delivery.
  v_is_member := exists (
    select 1 from memberships m
     where m.user_id = v_uid and m.tenant = v_tenant
       and m.status = 'active' and m.expires_at > now()
  );
  v_shipping := case when v_collect then 0
                     when v_is_member or v_subtotal >= 50000 then 0 else 3000 end;
  v_total := (v_subtotal - v_disc_cents) + v_shipping;

  -- Prefix from the tenants row ('224' for 224); suffix logic unchanged.
  -- order_number is still globally unique (orders_order_number_key), but
  -- order_prefix is unique per store, so another store can never hold a
  -- number with this prefix: checking this store's rows is enough.
  loop
    v_number := v_prefix || '-' || upper(substr(md5(gen_random_uuid()::text), 1, 6));
    exit when not exists (
      select 1 from orders where order_number = v_number and tenant = v_tenant
    );
  end loop;

  insert into orders (
    customer_name, customer_email, customer_phone, items, subtotal, shipping_fee,
    discount_code, discount_cents,
    total, status, payment_method, order_number, status_history, shipping_address, user_id,
    tenant
  ) values (
    p_customer->>'name', v_email, p_customer->>'phone', v_items, v_subtotal, v_shipping,
    v_disc_code, v_disc_cents,
    v_total, 'pending', p_payment_method, v_number,
    jsonb_build_array(jsonb_build_object('status', 'pending', 'at', now())),
    -- COLLECT: no address is stored, whatever the client sent.
    case when v_collect then '{}'::jsonb else jsonb_build_object(
      'street', p_customer->>'street', 'apartment', p_customer->>'apartment',
      'city', p_customer->>'city', 'province', p_customer->>'province',
      'postalCode', p_customer->>'postalCode'
    ) end,
    v_uid,
    v_tenant
  ) returning id into v_id;

  -- guarded decrement: aborts (rolls back the whole order) if another txn won
  -- Variant lines decrement the VARIANT; the sync trigger then recomputes the
  -- product's total. Plain lines decrement the product as before.
  for v_item in select * from jsonb_array_elements(v_items) loop
    if v_item ? 'variant_id' then
      update product_variants
         set stock_quantity = stock_quantity - (v_item->>'quantity')::int
       where id = (v_item->>'variant_id')::uuid
         and tenant = v_tenant
         and stock_quantity >= (v_item->>'quantity')::int;
    else
      update products
         set stock_quantity = stock_quantity - (v_item->>'quantity')::int
       where id = (v_item->>'id')::uuid
         and tenant = v_tenant
         and stock_quantity >= (v_item->>'quantity')::int;
    end if;
    if not found then raise exception 'Insufficient stock'; end if;
  end loop;

  -- Redemption accounting, same shape as the guarded stock decrement above:
  -- take the row lock first, then increment behind a WHERE that re-checks the
  -- cap under that lock. discount_eval's earlier check is advisory — two
  -- concurrent checkouts can both pass it — so the last redemption of a
  -- capped code is settled here, and losing it rolls the whole order back
  -- rather than over-redeeming. Locked AFTER the product rows so every caller
  -- takes the same lock order (products, then discount_codes).
  -- Codes are unique per store (tenant, code): only this store's row counts.
  if v_disc_code is not null then
    perform 1 from discount_codes where code = v_disc_code and tenant = v_tenant for update;
    update discount_codes
       set times_redeemed = times_redeemed + 1
     where code = v_disc_code
       and tenant = v_tenant
       and (max_redemptions is null or times_redeemed < max_redemptions);
    if not found then
      raise exception 'Discount code: that code has just been fully redeemed';
    end if;
  end if;

  return jsonb_build_object(
    'id', v_id, 'order_number', v_number,
    'subtotal', v_subtotal, 'shipping_fee', v_shipping,
    'discount_code', v_disc_code, 'discount_cents', v_disc_cents,
    'total', v_total, 'status', 'pending'
  );
end;
$function$;


-- ---- 3. set_order_pin ---------------------------------------------------------
-- From 20261110120000_order_location_pin.sql, plus the collect refusal.
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
  -- COLLECT (20261124120000): a collect store gathers no location data.
  -- Same message as every other refusal.
  if public.tenant_fulfilment() = 'collect' then
    raise exception 'Order not found';
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

-- ---- 4. is_driver -------------------------------------------------------------
-- From 20261102130000_tenant_policies.sql, plus the fulfilment condition.
create or replace function public.is_driver()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from drivers
     where user_id = auth.uid()
       and active
       and tenant = public.current_tenant()
  ) and public.tenant_fulfilment() = 'delivery';
$$;
