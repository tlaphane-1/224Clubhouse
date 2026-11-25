-- E420 in-store system, part 2a: counter sales
-- (spec: docs/superpowers/specs/2026-11-24-e420-in-store-design.md,
--  plan: docs/superpowers/plans/2026-11-25-counter-sales.md).
--
-- A counter sale is an order with channel = 'counter', stored as already
-- collected and paid. Only staff on an open shift can record one, through
-- record_counter_sale, which re-prices from the database and decrements stock
-- under row locks with the same rules as place_cod_order (variants, member-
-- only products, availability). Staff can also look up a customer and their
-- last 10 orders (the "memory" the owner asked for). All store-scoped.

alter table public.orders add column if not exists channel text not null default 'online';
alter table public.orders drop constraint if exists orders_channel_check;
alter table public.orders add constraint orders_channel_check check (channel in ('online', 'counter'));
alter table public.orders add column if not exists served_by uuid references auth.users(id) on delete set null;
create index if not exists orders_tenant_phone_idx on public.orders (tenant, customer_phone);

-- ---- customer search -------------------------------------------------------------
create or replace function public.counter_find_customers(p_query text)
returns table(user_id uuid, full_name text, phone text, email text,
              member_status text, tier_name text, expires_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant text := public.current_tenant();
  v_pat    text;
begin
  if not public.is_staff() then
    raise exception 'Not authorized';
  end if;
  if length(trim(coalesce(p_query, ''))) < 2 then
    return;
  end if;
  -- Literal match: escape LIKE wildcards in what the cashier typed.
  v_pat := '%' || replace(replace(replace(trim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  with people as (
    select m.user_id, m.full_name as name, m.phone, m.email, m.created_at as seen
      from memberships m
     where m.tenant = v_tenant
       and (m.full_name ilike v_pat or m.phone ilike v_pat or m.email ilike v_pat)
    union all
    select o.user_id, o.customer_name, o.customer_phone, nullif(o.customer_email, ''), o.created_at
      from orders o
     where o.tenant = v_tenant
       and (o.customer_name ilike v_pat or o.customer_phone ilike v_pat or o.customer_email ilike v_pat)
  ),
  latest as (
    -- One row per account, or per phone number for walk-ins.
    select distinct on (coalesce(p.user_id::text, p.phone)) p.user_id, p.name, p.phone, p.email, p.seen
      from people p
     order by coalesce(p.user_id::text, p.phone), p.seen desc
  )
  select l.user_id, l.name, l.phone, l.email,
         case when mm.id is null then 'none'
              when mm.status = 'active' and mm.expires_at > now() then 'active'
              when mm.status = 'pending' then 'pending'
              else 'expired' end,
         coalesce(t.name, mm.tier),
         mm.expires_at
    from latest l
    left join lateral (
      select m.id, m.status, m.expires_at, m.tier, m.tier_id
        from memberships m
       where l.user_id is not null and m.user_id = l.user_id and m.tenant = v_tenant
       order by (m.status = 'active' and m.expires_at > now()) desc, m.created_at desc
       limit 1
    ) mm on true
    left join membership_tiers t on t.id = mm.tier_id and t.tenant = v_tenant
   order by l.seen desc
   limit 10;
end;
$$;

-- ---- customer history ("memory") -----------------------------------------------------
create or replace function public.counter_customer_history(p_user_id uuid, p_phone text)
returns table(order_number text, created_at timestamptz, items jsonb, total integer, channel text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Not authorized';
  end if;
  if p_user_id is null and coalesce(trim(p_phone), '') = '' then
    return;
  end if;
  return query
  select o.order_number, o.created_at, o.items, o.total, o.channel
    from orders o
   where o.tenant = public.current_tenant()
     and o.status <> 'cancelled'
     and (case when p_user_id is not null then o.user_id = p_user_id
               else o.customer_phone = trim(p_phone) end)
   order by o.created_at desc
   limit 10;
end;
$$;

-- ---- record a counter sale -------------------------------------------------------------
-- Item handling copied from place_cod_order (20261124120000) minus discounts,
-- the age-profile check (the cashier checks ID in person: p_id_checked) and
-- the membership-after-first-order rule (that is about online ordering).
create or replace function public.record_counter_sale(
  p_customer jsonb, p_items jsonb, p_payment_method text, p_id_checked boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_tenant   text := public.current_tenant();
  v_prefix   text := public.tenant_order_prefix();
  v_user     uuid;
  v_email    text := '';
  v_item     jsonb;
  v_prod     products%rowtype;
  v_var      product_variants%rowtype;
  v_var_id   uuid;
  v_price    int;
  v_qty      int;
  v_items    jsonb := '[]'::jsonb;
  v_subtotal int := 0;
  v_number   text;
  v_id       uuid;
  v_member   boolean;
begin
  if v_uid is null or not public.is_staff() then
    raise exception 'Not authorized';
  end if;
  if v_prefix is null then
    raise exception 'Unknown store';
  end if;
  if not exists (select 1 from shifts where user_id = v_uid and tenant = v_tenant and ended_at is null) then
    raise exception 'Start your shift first';
  end if;
  if not coalesce(p_id_checked, false) then
    raise exception 'Confirm you checked their ID';
  end if;
  if p_payment_method not in ('cash_on_delivery', 'card_on_delivery') then
    raise exception 'Invalid payment method';
  end if;
  if coalesce(trim(p_customer->>'name'), '') = '' or coalesce(trim(p_customer->>'phone'), '') = '' then
    raise exception 'Missing customer details';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'No items in order';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'Too many items in order';
  end if;

  -- An account is linked only if it belongs to this store; otherwise walk-in.
  select u.id, coalesce(u.email, '') into v_user, v_email
    from auth.users u
   where u.id = nullif(p_customer->>'user_id', '')::uuid
     and coalesce(nullif(u.raw_app_meta_data->>'tenant', ''), public.default_tenant()) = v_tenant;
  if v_user is null then
    v_email := '';
  end if;
  v_member := v_user is not null and exists (
    select 1 from memberships m
     where m.user_id = v_user and m.tenant = v_tenant
       and m.status = 'active' and m.expires_at > now()
  );

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_item->>'quantity')::int, 0);
    if v_qty < 1 or v_qty > 100 then
      raise exception 'Invalid quantity';
    end if;
    select * into v_prod from products
     where id = (v_item->>'id')::uuid and tenant = v_tenant
     for update;
    if not found then raise exception 'Product not found'; end if;
    if not v_prod.is_available then raise exception 'Product "%" is unavailable', v_prod.name; end if;
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
      if exists (select 1 from product_variants where product_id = v_prod.id and tenant = v_tenant) then
        raise exception 'Please choose an option for "%"', v_prod.name;
      end if;
      if v_prod.stock_quantity < v_qty then raise exception 'Insufficient stock for "%"', v_prod.name; end if;
      v_price := v_prod.price;
    end if;
    if v_prod.is_member_only and not v_member then
      raise exception '"%" is for members only', v_prod.name;
    end if;
    v_subtotal := v_subtotal + v_price * v_qty;
    v_items := v_items || jsonb_build_array(
      jsonb_build_object(
        'id', v_prod.id, 'name', v_prod.name, 'price', v_price,
        'quantity', v_qty, 'slug', v_prod.slug
      ) || case when v_var_id is null then '{}'::jsonb
                else jsonb_build_object('variant_id', v_var.id, 'variant_label', v_var.label) end
    );
  end loop;

  loop
    v_number := v_prefix || '-' || upper(substr(md5(gen_random_uuid()::text), 1, 6));
    exit when not exists (select 1 from orders where order_number = v_number and tenant = v_tenant);
  end loop;

  insert into orders (
    customer_name, customer_email, customer_phone, items, subtotal, shipping_fee,
    discount_cents, total, status, payment_method, order_number, status_history,
    shipping_address, user_id, tenant, channel, served_by,
    paid_at, paid_amount_cents, payment_confirmed_by
  ) values (
    trim(p_customer->>'name'), v_email, trim(p_customer->>'phone'), v_items, v_subtotal, 0,
    0, v_subtotal, 'delivered', p_payment_method, v_number,
    jsonb_build_array(jsonb_build_object('status', 'delivered', 'at', now(), 'actor', v_uid, 'channel', 'counter')),
    '{}'::jsonb, v_user, v_tenant, 'counter', v_uid,
    now(), v_subtotal, v_uid
  ) returning id into v_id;

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

  return jsonb_build_object('id', v_id, 'order_number', v_number, 'total', v_subtotal);
end;
$$;

revoke execute on function public.counter_find_customers(text),
  public.counter_customer_history(uuid, text),
  public.record_counter_sale(jsonb, jsonb, text, boolean) from public, anon;
grant execute on function public.counter_find_customers(text),
  public.counter_customer_history(uuid, text),
  public.record_counter_sale(jsonb, jsonb, text, boolean) to authenticated;
