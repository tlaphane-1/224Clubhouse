-- ============================================================
-- 224 Clubhouse — Security & reliability hardening
-- ============================================================
-- - Lock orders to admins only (PII; anon uses the SECURITY DEFINER RPCs).
-- - Prevent stock oversell (row lock + guarded decrement + non-negative check).
-- - Input caps on place_cod_order (anti-abuse).
-- - Lock the forgeable membership insert behind place_membership (server prices
--   the tier; membership is created 'pending' for admin confirmation — no more
--   self-granted 'active' memberships with the public anon key).
-- - contact_messages table so the contact form stops silently dropping messages.
-- - Harden the unused decrement_stock (pin search_path, revoke from anon).
-- ============================================================

-- ---- 1. orders: admin-only -------------------------------------------------
-- Order creation = place_cod_order (definer); tracking = get_order_tracking
-- (definer); confirmation page uses router state. So no anon/non-admin needs
-- direct table access. (No INSERT policy: creation is RPC-only.)
drop policy if exists "orders_auth_all" on orders;
drop policy if exists "orders_admin_select" on orders;
drop policy if exists "orders_admin_update" on orders;
drop policy if exists "orders_admin_delete" on orders;
create policy "orders_admin_select" on orders for select using (is_admin());
create policy "orders_admin_update" on orders for update using (is_admin()) with check (is_admin());
create policy "orders_admin_delete" on orders for delete using (is_admin());

-- ---- 2. memberships: lock direct inserts -----------------------------------
-- read/update/delete are already admin-only (20260604120000). Drop the
-- with-check(true) public insert; creation now flows through place_membership.
drop policy if exists "memberships_public_insert" on memberships;

-- ---- 3. products: stock can never go negative ------------------------------
update products set stock_quantity = 0 where stock_quantity < 0;
alter table products drop constraint if exists products_stock_nonneg;
alter table products add constraint products_stock_nonneg check (stock_quantity >= 0);

-- ---- 4. place_cod_order: locked, guarded, input-capped ---------------------
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
  if jsonb_array_length(p_items) > 50 then
    raise exception 'Too many items in order';
  end if;
  if coalesce(trim(p_customer->>'name'), '') = ''
     or coalesce(trim(p_customer->>'email'), '') = ''
     or coalesce(trim(p_customer->>'phone'), '') = '' then
    raise exception 'Missing customer details';
  end if;
  if (p_customer->>'email') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Invalid email address';
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

grant execute on function place_cod_order(jsonb, jsonb, text) to anon, authenticated;

-- ---- 5. place_membership: server-priced, admin-confirmed -------------------
-- Server is authoritative for price + duration; created 'pending' so an admin
-- confirms payment before it becomes active. Closes the "insert an active,
-- amount-0 membership with the anon key" hole.
create or replace function place_membership(p_customer jsonb, p_tier text, p_reference text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount int;
  v_days   int;
  v_id     uuid;
begin
  if    p_tier = 'daily'   then v_amount := 1000;  v_days := 1;
  elsif p_tier = 'weekly'  then v_amount := 3000;  v_days := 7;
  elsif p_tier = 'monthly' then v_amount := 5000;  v_days := 30;
  else raise exception 'Invalid tier'; end if;

  if coalesce(trim(p_customer->>'full_name'), '') = ''
     or coalesce(trim(p_customer->>'email'), '') = ''
     or coalesce(trim(p_customer->>'phone'), '') = ''
     or coalesce(trim(p_customer->>'date_of_birth'), '') = '' then
    raise exception 'Missing required details';
  end if;
  if (p_customer->>'email') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Invalid email address';
  end if;
  if ((p_customer->>'date_of_birth')::date) > (current_date - interval '21 years') then
    raise exception 'Must be 21 or older';
  end if;

  insert into memberships (
    full_name, email, phone, date_of_birth, id_number, tier, status, amount,
    paystack_reference, starts_at, expires_at
  ) values (
    p_customer->>'full_name', p_customer->>'email', p_customer->>'phone',
    (p_customer->>'date_of_birth')::date, nullif(trim(p_customer->>'id_number'), ''),
    p_tier, 'pending', v_amount, nullif(trim(p_reference), ''),
    now(), now() + (v_days || ' days')::interval
  ) returning id into v_id;

  return jsonb_build_object('id', v_id, 'tier', p_tier, 'amount', v_amount, 'status', 'pending');
end;
$$;

grant execute on function place_membership(jsonb, text, text) to anon, authenticated;

-- ---- 6. contact_messages ---------------------------------------------------
create table if not exists contact_messages (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) <= 200),
  email       text not null check (char_length(email) <= 320),
  subject     text check (char_length(subject) <= 300),
  message     text not null check (char_length(message) between 1 and 5000),
  created_at  timestamptz default now()
);
alter table contact_messages enable row level security;
drop policy if exists "contact_public_insert" on contact_messages;
drop policy if exists "contact_admin_select" on contact_messages;
create policy "contact_public_insert" on contact_messages for insert with check (true);
create policy "contact_admin_select"  on contact_messages for select using (is_admin());

-- ---- 7. decrement_stock: harden the legacy definer -------------------------
create or replace function decrement_stock(product_id uuid, qty integer)
returns void
language sql
security definer
set search_path = public
as $$
  update products set stock_quantity = greatest(0, stock_quantity - qty) where id = product_id;
$$;
revoke execute on function decrement_stock(uuid, integer) from anon, public;
