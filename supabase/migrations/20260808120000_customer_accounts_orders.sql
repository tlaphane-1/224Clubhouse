-- ============================================================
-- 224 Clubhouse — Customer accounts own their orders
-- ============================================================
-- Checkout now requires a signed-in customer. Orders carry the buyer's
-- auth.users id, customers read their OWN orders directly under RLS, and
-- place_cod_order stamps the verified account email onto the order (the
-- email field is no longer caller-supplied — tracking RPCs key on
-- customer_email, so account-email == order-email keeps them working).
--
-- Deliberately NOT done here (owner decisions, 2026-08-08):
--   - No backfill of user_id onto pre-account orders: auto-linking by email
--     would let anyone who signs up with a guessed address claim that
--     address's order history. Old orders stay reachable via /track.
--   - get_order_tracking / get_orders_by_email keep their anon grants so
--     those old anonymous orders remain trackable.
-- ============================================================

-- ---- 1. orders.user_id ------------------------------------------------------
alter table orders add column if not exists user_id uuid references auth.users(id) on delete set null;
create index if not exists orders_user_id_idx on orders(user_id);

-- ---- 2. owners read their own orders ---------------------------------------
-- Anon still reads nothing: auth.uid() is null for the anon role, so the
-- anon-contract negative control (zero rows) keeps passing.
drop policy if exists "orders_owner_select" on orders;
create policy "orders_owner_select" on orders
  for select to authenticated
  using (user_id = auth.uid());

-- ---- 3. place_cod_order: signed-in customers only ---------------------------
-- Same validation / row-locking / server-side pricing / guarded decrement as
-- 20260623120000, plus: requires auth.uid(), stamps user_id, and overrides
-- customer_email with the account's (verified) email.
create or replace function place_cod_order(p_customer jsonb, p_items jsonb, p_payment_method text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_email    text;
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
  if v_uid is null then
    raise exception 'Sign in required to place an order';
  end if;
  select email into v_email from auth.users where id = v_uid;
  if coalesce(trim(v_email), '') = '' then
    raise exception 'Account has no email address';
  end if;

  if p_payment_method not in ('cash_on_delivery','card_on_delivery') then
    raise exception 'Invalid payment method';
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
    select * into v_prod from products where id = (v_item->>'id')::uuid for update;
    if not found then raise exception 'Product not found'; end if;
    if not v_prod.is_available then raise exception 'Product "%" is unavailable', v_prod.name; end if;
    if v_prod.stock_quantity < v_qty then raise exception 'Insufficient stock for "%"', v_prod.name; end if;
    v_subtotal := v_subtotal + v_prod.price * v_qty;
    v_items := v_items || jsonb_build_object(
      'id', v_prod.id, 'name', v_prod.name, 'price', v_prod.price,
      'quantity', v_qty, 'slug', v_prod.slug
    );
  end loop;

  v_shipping := case when v_subtotal >= 50000 then 0 else 8000 end;
  v_total := v_subtotal + v_shipping;

  loop
    v_number := '224-' || upper(substr(md5(gen_random_uuid()::text), 1, 6));
    exit when not exists (select 1 from orders where order_number = v_number);
  end loop;

  insert into orders (
    customer_name, customer_email, customer_phone, items, subtotal, shipping_fee,
    total, status, payment_method, order_number, status_history, shipping_address, user_id
  ) values (
    p_customer->>'name', v_email, p_customer->>'phone', v_items, v_subtotal, v_shipping,
    v_total, 'pending', p_payment_method, v_number,
    jsonb_build_array(jsonb_build_object('status', 'pending', 'at', now())),
    jsonb_build_object(
      'street', p_customer->>'street', 'apartment', p_customer->>'apartment',
      'city', p_customer->>'city', 'province', p_customer->>'province',
      'postalCode', p_customer->>'postalCode'
    ),
    v_uid
  ) returning id into v_id;

  -- guarded decrement: aborts (rolls back the whole order) if another txn won
  for v_item in select * from jsonb_array_elements(v_items) loop
    update products
       set stock_quantity = stock_quantity - (v_item->>'quantity')::int
     where id = (v_item->>'id')::uuid
       and stock_quantity >= (v_item->>'quantity')::int;
    if not found then raise exception 'Insufficient stock'; end if;
  end loop;

  return jsonb_build_object(
    'id', v_id, 'order_number', v_number,
    'subtotal', v_subtotal, 'shipping_fee', v_shipping, 'total', v_total, 'status', 'pending'
  );
end;
$$;

-- create-or-replace preserves the old grants, and EXECUTE defaults to PUBLIC —
-- revoke both explicitly, then grant only to signed-in users. The auth.uid()
-- check inside the function stays as defense-in-depth.
revoke execute on function place_cod_order(jsonb, jsonb, text) from public, anon;
grant  execute on function place_cod_order(jsonb, jsonb, text) to authenticated;
