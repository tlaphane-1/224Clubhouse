-- ============================================================
-- 224 Clubhouse — Cash/Card on Delivery + live order tracking
-- ============================================================
-- While the online paygate is being confirmed, orders are placed as
-- Cash/Card on Delivery. Anonymous customers create and track orders ONLY
-- through SECURITY DEFINER RPCs below — the orders table itself stays locked
-- (no anon direct read/write), so prices can't be tampered with and PII isn't
-- exposed. Customers track by order number + email (email is the shared
-- secret; no enumeration).
-- ============================================================

-- ---- 1. Schema additions ----------------------------------------------
alter table orders add column if not exists payment_method text not null default 'online';
alter table orders add column if not exists order_number   text;
alter table orders add column if not exists tracking_token uuid not null default gen_random_uuid();
alter table orders add column if not exists status_history jsonb not null default '[]'::jsonb;

-- Widen the status set with delivery stages (keep legacy values valid).
alter table orders drop constraint if exists orders_status_check;
alter table orders add constraint orders_status_check check (
  status in ('pending','confirmed','preparing','out_for_delivery',
             'paid','processing','shipped','delivered','cancelled')
);

alter table orders drop constraint if exists orders_payment_method_check;
alter table orders add constraint orders_payment_method_check check (
  payment_method in ('cash_on_delivery','card_on_delivery','online')
);

-- Backfill a human-friendly order number for any existing rows.
update orders set order_number = '224-' || upper(substr(md5(id::text), 1, 6))
  where order_number is null;

create unique index if not exists orders_order_number_key on orders(order_number);

-- ---- 2. place_cod_order — anonymous, server-authoritative creation ------
-- Recomputes totals from DB prices (anti-tamper), validates stock, creates the
-- order, decrements stock, returns a public summary. Runs as definer so anon
-- never needs INSERT rights on orders.
create or replace function place_cod_order(p_customer jsonb, p_items jsonb, p_payment_method text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item     jsonb;
  v_prod     products%rowtype;
  v_qty      int;
  v_items    jsonb := '[]'::jsonb;
  v_subtotal int := 0;
  v_shipping int;
  v_total    int;
  v_number   text;
  v_id       uuid;
begin
  if p_payment_method not in ('cash_on_delivery','card_on_delivery') then
    raise exception 'Invalid payment method';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'No items in order';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := greatest(1, coalesce((v_item->>'quantity')::int, 1));
    select * into v_prod from products where id = (v_item->>'id')::uuid;
    if not found then raise exception 'Product not found'; end if;
    if not v_prod.is_available then raise exception 'Product "%" is unavailable', v_prod.name; end if;
    if v_prod.stock_quantity < v_qty then raise exception 'Insufficient stock for "%"', v_prod.name; end if;
    v_subtotal := v_subtotal + v_prod.price * v_qty;
    v_items := v_items || jsonb_build_object(
      'id', v_prod.id, 'name', v_prod.name, 'price', v_prod.price,
      'quantity', v_qty, 'slug', v_prod.slug
    );
  end loop;

  v_shipping := case when v_subtotal >= 50000 then 0 else 8000 end; -- mirrors OrderSummary
  v_total := v_subtotal + v_shipping;

  loop
    v_number := '224-' || upper(substr(md5(gen_random_uuid()::text), 1, 6));
    exit when not exists (select 1 from orders where order_number = v_number);
  end loop;

  insert into orders (
    customer_name, customer_email, customer_phone, items, subtotal, shipping_fee,
    total, status, payment_method, order_number, status_history, shipping_address
  ) values (
    p_customer->>'name', p_customer->>'email', p_customer->>'phone', v_items, v_subtotal, v_shipping,
    v_total, 'pending', p_payment_method, v_number,
    jsonb_build_array(jsonb_build_object('status', 'pending', 'at', now())),
    jsonb_build_object(
      'street', p_customer->>'street', 'apartment', p_customer->>'apartment',
      'city', p_customer->>'city', 'province', p_customer->>'province',
      'postalCode', p_customer->>'postalCode'
    )
  ) returning id into v_id;

  for v_item in select * from jsonb_array_elements(v_items) loop
    update products set stock_quantity = stock_quantity - (v_item->>'quantity')::int
      where id = (v_item->>'id')::uuid;
  end loop;

  return jsonb_build_object(
    'id', v_id, 'order_number', v_number,
    'subtotal', v_subtotal, 'shipping_fee', v_shipping, 'total', v_total, 'status', 'pending'
  );
end;
$$;

grant execute on function place_cod_order(jsonb, jsonb, text) to anon, authenticated;

-- ---- 3. get_order_tracking — anonymous, PII-safe live status -----------
-- Requires BOTH order number AND matching email (no enumeration). Returns only
-- the fields the tracking page needs; no full address / phone / email.
create or replace function get_order_tracking(p_order_number text, p_email text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'order_number',        o.order_number,
    'status',              o.status,
    'status_history',      o.status_history,
    'payment_method',      o.payment_method,
    'subtotal',            o.subtotal,
    'shipping_fee',        o.shipping_fee,
    'total',               o.total,
    'items',               o.items,
    'created_at',          o.created_at,
    'customer_first_name', split_part(o.customer_name, ' ', 1),
    'city',                o.shipping_address->>'city'
  )
  from orders o
  where o.order_number = upper(trim(p_order_number))
    and lower(o.customer_email) = lower(trim(p_email))
  limit 1;
$$;

grant execute on function get_order_tracking(text, text) to anon, authenticated;

-- ---- 4. admin_update_order_status — admin-only, appends history --------
create or replace function admin_update_order_status(p_order_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_row orders%rowtype;
begin
  if not is_admin() then raise exception 'Not authorized'; end if;
  if p_status not in ('pending','confirmed','preparing','out_for_delivery',
                      'paid','processing','shipped','delivered','cancelled') then
    raise exception 'Invalid status';
  end if;
  update orders
    set status = p_status,
        status_history = coalesce(status_history, '[]'::jsonb)
                         || jsonb_build_object('status', p_status, 'at', now())
    where id = p_order_id
    returning * into v_row;
  if not found then raise exception 'Order not found'; end if;
  return jsonb_build_object('id', v_row.id, 'status', v_row.status);
end;
$$;

grant execute on function admin_update_order_status(uuid, text) to authenticated;
