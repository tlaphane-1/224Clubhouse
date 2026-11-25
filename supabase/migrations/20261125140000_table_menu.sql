-- E420 in-store system, part 3: membership card, table menu orders, ratings
-- (plan: docs/superpowers/plans/2026-11-25-table-menu.md).
--
-- Each customer account gets an unguessable card token, shown as a QR on
-- their phone. The counter tablet (signed in as staff) scans it: at the
-- counter to pick the customer for a sale, and in table mode so the customer
-- can see their own orders, send an order to the counter and rate products
-- they've received. A card from another store, a forged one or a replaced
-- one is "Card not recognised". Table orders take no stock: the cashier loads
-- them into a normal counter sale.

-- ---- member_cards ----------------------------------------------------------------
create table if not exists public.member_cards (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  tenant     text not null default public.current_tenant() references public.tenants(slug),
  token      uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now()
);
alter table public.member_cards enable row level security;

drop policy if exists member_cards_self_select on public.member_cards;
create policy member_cards_self_select on public.member_cards for select
  using ((select auth.uid()) = user_id and tenant = (select public.current_tenant()));

create or replace function public.my_member_card()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_tenant text := public.current_tenant();
  v_token  uuid;
begin
  if v_uid is null then
    raise exception 'Sign in required';
  end if;
  select token into v_token from member_cards where user_id = v_uid and tenant = v_tenant;
  if v_token is null then
    insert into member_cards (user_id, tenant) values (v_uid, v_tenant)
    on conflict (user_id) do nothing
    returning token into v_token;
    if v_token is null then
      -- A card row in another store (one login belongs to one store).
      raise exception 'Not available for this account';
    end if;
  end if;
  return v_token;
end;
$$;

create or replace function public.rotate_member_card()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token uuid;
begin
  perform public.my_member_card();
  update member_cards set token = gen_random_uuid(), created_at = now()
   where user_id = auth.uid() and tenant = public.current_tenant()
  returning token into v_token;
  return v_token;
end;
$$;

-- The account a card belongs to, in THIS store. Not granted to anyone.
create or replace function public.card_user(p_token uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select user_id from member_cards where token = p_token and tenant = public.current_tenant();
$$;
revoke execute on function public.card_user(uuid) from public, anon, authenticated;

-- The customer's display name and phone, from their newest order or membership.
create or replace function public.account_contact(p_uid uuid)
returns table(full_name text, phone text)
language sql
stable
security definer
set search_path = public
as $$
  select name, phone from (
    select o.customer_name as name, o.customer_phone as phone, o.created_at as seen
      from orders o where o.user_id = p_uid and o.tenant = public.current_tenant()
    union all
    select m.full_name, m.phone, m.created_at
      from memberships m where m.user_id = p_uid and m.tenant = public.current_tenant()
  ) x
  order by seen desc
  limit 1;
$$;
revoke execute on function public.account_contact(uuid) from public, anon, authenticated;

-- Membership status of an account in this store: active | pending | expired | none.
create or replace function public.account_membership(p_uid uuid)
returns table(member_status text, tier_name text, expires_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
           select case when m.status = 'active' and m.expires_at > now() then 'active'
                       when m.status = 'pending' then 'pending' else 'expired' end
             from memberships m
            where m.user_id = p_uid and m.tenant = public.current_tenant()
            order by (m.status = 'active' and m.expires_at > now()) desc, m.created_at desc
            limit 1), 'none'),
         (select coalesce(t.name, m.tier)
            from memberships m left join membership_tiers t on t.id = m.tier_id and t.tenant = m.tenant
           where m.user_id = p_uid and m.tenant = public.current_tenant()
           order by (m.status = 'active' and m.expires_at > now()) desc, m.created_at desc
           limit 1),
         (select m.expires_at
            from memberships m
           where m.user_id = p_uid and m.tenant = public.current_tenant()
           order by (m.status = 'active' and m.expires_at > now()) desc, m.created_at desc
           limit 1);
$$;
revoke execute on function public.account_membership(uuid) from public, anon, authenticated;

-- ---- counter: pick the customer by card ----------------------------------------------
create or replace function public.card_customer(p_token uuid)
returns table(user_id uuid, full_name text, phone text,
              member_status text, tier_name text, expires_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid;
begin
  if not public.is_staff() then
    raise exception 'Not authorized';
  end if;
  if not public.counter_on_shift() then
    raise exception 'Start your shift first';
  end if;
  v_uid := public.card_user(p_token);
  if v_uid is null then
    raise exception 'Card not recognised';
  end if;
  return query
  select v_uid, coalesce(c.full_name, ''), coalesce(c.phone, ''), m.member_status, m.tier_name, m.expires_at
    from public.account_membership(v_uid) m
    left join public.account_contact(v_uid) c on true;
end;
$$;

-- ---- table mode ------------------------------------------------------------------------
create or replace function public.table_identify(p_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant text := public.current_tenant();
  v_uid    uuid;
  v_name   text;
begin
  if not public.is_staff() then
    raise exception 'Not authorized';
  end if;
  v_uid := public.card_user(p_token);
  if v_uid is null then
    raise exception 'Card not recognised';
  end if;
  select full_name into v_name from public.account_contact(v_uid);

  return jsonb_build_object(
    'first_name', coalesce(nullif(split_part(trim(coalesce(v_name, '')), ' ', 1), ''), 'there'),
    'member_status', (select member_status from public.account_membership(v_uid)),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object('order_number', o.order_number, 'created_at', o.created_at, 'items', o.items)
                       order by o.created_at desc)
        from (select * from orders
               where user_id = v_uid and tenant = v_tenant and status <> 'cancelled'
               order by created_at desc limit 10) o
    ), '[]'::jsonb),
    'reviewable', coalesce((
      select jsonb_agg(jsonb_build_object('product_id', p.id, 'name', p.name) order by p.name)
        from products p
       where p.tenant = v_tenant
         and p.id in (
           select (i->>'id')::uuid
             from orders o, jsonb_array_elements(o.items) i
            where o.user_id = v_uid and o.tenant = v_tenant and o.status = 'delivered'
         )
       limit 20
    ), '[]'::jsonb)
  );
end;
$$;

create table if not exists public.table_requests (
  id         uuid primary key default gen_random_uuid(),
  tenant     text not null default public.current_tenant() references public.tenants(slug),
  user_id    uuid not null references auth.users(id) on delete cascade,
  items      jsonb not null,
  status     text not null default 'pending' check (status in ('pending', 'done', 'cancelled')),
  created_at timestamptz not null default now(),
  closed_at  timestamptz,
  closed_by  uuid references auth.users(id) on delete set null
);
alter table public.table_requests enable row level security;
create index if not exists table_requests_pending_idx
  on public.table_requests (tenant, created_at) where status = 'pending';

drop policy if exists table_requests_admin_select on public.table_requests;
create policy table_requests_admin_select on public.table_requests for select
  using (tenant = (select public.current_tenant()) and public.is_admin());

create or replace function public.table_submit_request(p_token uuid, p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant text := public.current_tenant();
  v_uid    uuid;
  v_item   jsonb;
  v_qty    int;
  v_items  jsonb := '[]'::jsonb;
  v_id     uuid;
begin
  if not public.is_staff() then
    raise exception 'Not authorized';
  end if;
  v_uid := public.card_user(p_token);
  if v_uid is null then
    raise exception 'Card not recognised';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'No items in order';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'Too many items in order';
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_item->>'quantity')::int, 0);
    if v_qty < 1 or v_qty > 100 then
      raise exception 'Invalid quantity';
    end if;
    if not exists (select 1 from products
                    where id = (v_item->>'id')::uuid and tenant = v_tenant and is_available) then
      raise exception 'Product not found';
    end if;
    if nullif(v_item->>'variant_id', '') is not null and not exists (
      select 1 from product_variants
       where id = (v_item->>'variant_id')::uuid and product_id = (v_item->>'id')::uuid
         and tenant = v_tenant and is_available) then
      raise exception 'Product not found';
    end if;
    v_items := v_items || jsonb_build_array(
      jsonb_build_object('id', v_item->>'id', 'quantity', v_qty)
      || case when nullif(v_item->>'variant_id', '') is null then '{}'::jsonb
              else jsonb_build_object('variant_id', v_item->>'variant_id') end);
  end loop;

  insert into table_requests (tenant, user_id, items) values (v_tenant, v_uid, v_items)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.table_submit_review(p_token uuid, p_product_id uuid, p_rating integer, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant text := public.current_tenant();
  v_uid    uuid;
  v_name   text;
  v_body   text := trim(coalesce(p_body, ''));
begin
  if not public.is_staff() then
    raise exception 'Not authorized';
  end if;
  v_uid := public.card_user(p_token);
  if v_uid is null then
    raise exception 'Card not recognised';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be between 1 and 5';
  end if;
  if length(v_body) > 1000 then
    raise exception 'Review is too long (1000 characters max)';
  end if;
  if not public.has_delivered_purchase(v_uid, p_product_id) then
    raise exception 'Only customers who have received this product can review it';
  end if;
  select full_name into v_name from public.account_contact(v_uid);
  v_name := left(coalesce(nullif(split_part(trim(coalesce(v_name, '')), ' ', 1), ''), 'Member'), 40);

  -- Same upsert and re-moderation as submit_product_review.
  insert into product_reviews (product_id, user_id, rating, body, display_name, tenant)
  values (p_product_id, v_uid, p_rating, v_body, v_name, v_tenant)
  on conflict (product_id, user_id) do update
     set rating = excluded.rating,
         body = excluded.body,
         display_name = excluded.display_name,
         status = 'pending',
         updated_at = now(),
         moderated_at = null
   where product_reviews.tenant = v_tenant;
  return jsonb_build_object('status', 'pending');
end;
$$;

-- ---- counter: table orders -----------------------------------------------------------------
create or replace function public.counter_table_requests()
returns table(id uuid, created_at timestamptz, user_id uuid, full_name text, phone text,
              member_status text, tier_name text, expires_at timestamptz, items jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant text := public.current_tenant();
begin
  if not public.is_staff() then
    raise exception 'Not authorized';
  end if;
  if not public.counter_on_shift() then
    raise exception 'Start your shift first';
  end if;
  return query
  select r.id, r.created_at, r.user_id, coalesce(c.full_name, ''), coalesce(c.phone, ''),
         m.member_status, m.tier_name, m.expires_at,
         coalesce((
           select jsonb_agg(
                    jsonb_build_object(
                      'id', p.id, 'variant_id', v.id, 'quantity', (i->>'quantity')::int,
                      'name', p.name, 'label', v.label,
                      'price', coalesce(v.price, p.price),
                      'stock', coalesce(v.stock_quantity, p.stock_quantity),
                      'available', p.is_available and coalesce(v.is_available, true)))
             from jsonb_array_elements(r.items) i
             join products p on p.id = (i->>'id')::uuid and p.tenant = v_tenant
             left join product_variants v on v.id = nullif(i->>'variant_id', '')::uuid and v.tenant = v_tenant
         ), '[]'::jsonb)
    from table_requests r
    left join lateral public.account_contact(r.user_id) c on true
    left join lateral public.account_membership(r.user_id) m on true
   where r.tenant = v_tenant
     and r.status = 'pending'
     and r.created_at > now() - interval '30 minutes'
   order by r.created_at;
end;
$$;

create or replace function public.counter_close_table_request(p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Not authorized';
  end if;
  if not public.counter_on_shift() then
    raise exception 'Start your shift first';
  end if;
  if p_status not in ('done', 'cancelled') then
    raise exception 'Invalid status';
  end if;
  update table_requests set status = p_status, closed_at = now(), closed_by = auth.uid()
   where id = p_id and tenant = public.current_tenant() and status = 'pending';
  if not found then
    raise exception 'Table order not found';
  end if;
end;
$$;

revoke execute on function public.my_member_card(), public.rotate_member_card(),
  public.card_customer(uuid), public.table_identify(uuid), public.table_submit_request(uuid, jsonb),
  public.table_submit_review(uuid, uuid, integer, text), public.counter_table_requests(),
  public.counter_close_table_request(uuid, text) from public, anon;
grant execute on function public.my_member_card(), public.rotate_member_card(),
  public.card_customer(uuid), public.table_identify(uuid), public.table_submit_request(uuid, jsonb),
  public.table_submit_review(uuid, uuid, integer, text), public.counter_table_requests(),
  public.counter_close_table_request(uuid, text) to authenticated;
