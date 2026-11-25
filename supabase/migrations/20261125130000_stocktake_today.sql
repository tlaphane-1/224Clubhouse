-- E420 in-store system, part 2b: stock-take and today's live summary
-- (plan: docs/superpowers/plans/2026-11-25-stocktake-dashboard.md).
--
-- Stock-take: staff on shift set the counted quantity of a product (or one
-- of its options) with a reason. Every change is logged in stock_adjustments
-- (who, when, old → new), written only by counter_set_stock.
-- Today: an aggregate of today's (South African day) sales for the counter
-- tablet and the admin dashboard — totals, online vs counter, top sellers,
-- low stock. No customer details.

create table if not exists public.stock_adjustments (
  id            uuid primary key default gen_random_uuid(),
  tenant        text not null default public.current_tenant() references public.tenants(slug),
  product_id    uuid not null references public.products(id) on delete cascade,
  variant_id    uuid references public.product_variants(id) on delete set null,
  product_name  text not null,
  variant_label text,
  old_qty       integer not null,
  new_qty       integer not null check (new_qty between 0 and 100000),
  reason        text not null check (reason in ('count', 'received', 'damaged', 'other')),
  note          text check (length(note) <= 200),
  user_id       uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
alter table public.stock_adjustments enable row level security;
create index if not exists stock_adjustments_tenant_created_idx
  on public.stock_adjustments (tenant, created_at desc);

drop policy if exists stock_adjustments_select on public.stock_adjustments;
create policy stock_adjustments_select on public.stock_adjustments for select
  using (
    tenant = (select public.current_tenant())
    and ((select auth.uid()) = user_id or public.is_admin())
  );

-- ---- counter_set_stock ------------------------------------------------------------
create or replace function public.counter_set_stock(
  p_product_id uuid, p_variant_id uuid, p_counted integer, p_reason text, p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant text := public.current_tenant();
  v_prod   products%rowtype;
  v_var    product_variants%rowtype;
  v_old    integer;
begin
  if not public.is_staff() then
    raise exception 'Not authorized';
  end if;
  if not public.counter_on_shift() then
    raise exception 'Start your shift first';
  end if;
  if p_counted is null or p_counted < 0 or p_counted > 100000 then
    raise exception 'Enter a count from 0 to 100000';
  end if;
  if p_reason is null or p_reason not in ('count', 'received', 'damaged', 'other') then
    raise exception 'Invalid reason';
  end if;
  if length(coalesce(p_note, '')) > 200 then
    raise exception 'Note is too long (200 characters max)';
  end if;

  select * into v_prod from products where id = p_product_id and tenant = v_tenant for update;
  if not found then
    raise exception 'Product not found';
  end if;

  if p_variant_id is not null then
    select * into v_var from product_variants
     where id = p_variant_id and product_id = v_prod.id and tenant = v_tenant
     for update;
    if not found then
      raise exception 'Product not found';
    end if;
    v_old := v_var.stock_quantity;
    -- The product_variants sync trigger recomputes the product's total.
    update product_variants set stock_quantity = p_counted where id = v_var.id and tenant = v_tenant;
  else
    if exists (select 1 from product_variants where product_id = v_prod.id and tenant = v_tenant) then
      raise exception 'Choose an option for "%"', v_prod.name;
    end if;
    v_old := v_prod.stock_quantity;
    update products set stock_quantity = p_counted where id = v_prod.id and tenant = v_tenant;
  end if;

  insert into stock_adjustments (tenant, product_id, variant_id, product_name, variant_label,
                                 old_qty, new_qty, reason, note, user_id)
  values (v_tenant, v_prod.id, p_variant_id, v_prod.name,
          case when p_variant_id is null then null else v_var.label end,
          v_old, p_counted, p_reason, nullif(trim(coalesce(p_note, '')), ''), auth.uid());

  return jsonb_build_object('old_qty', v_old, 'new_qty', p_counted);
end;
$$;

-- ---- store_today_summary ------------------------------------------------------------
create or replace function public.store_today_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant text := public.current_tenant();
  v_day    date := (now() at time zone 'Africa/Johannesburg')::date;
  v_from   timestamptz := (v_day::timestamp at time zone 'Africa/Johannesburg');
  v_to     timestamptz := ((v_day + 1)::timestamp at time zone 'Africa/Johannesburg');
begin
  if not public.is_staff() then
    raise exception 'Not authorized';
  end if;

  return jsonb_build_object(
    'day', v_day,
    'sales', (select count(*) from orders
               where tenant = v_tenant and status <> 'cancelled'
                 and created_at >= v_from and created_at < v_to),
    'total', (select coalesce(sum(total), 0) from orders
               where tenant = v_tenant and status <> 'cancelled'
                 and created_at >= v_from and created_at < v_to),
    'online', (select coalesce(sum(total), 0) from orders
                where tenant = v_tenant and status <> 'cancelled' and channel = 'online'
                  and created_at >= v_from and created_at < v_to),
    'counter', (select coalesce(sum(total), 0) from orders
                 where tenant = v_tenant and status <> 'cancelled' and channel = 'counter'
                   and created_at >= v_from and created_at < v_to),
    'top', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'quantity', qty) order by qty desc, name)
        from (
          select coalesce(i->>'name', '') || coalesce(' — ' || (i->>'variant_label'), '') as name,
                 sum((i->>'quantity')::int) as qty
            from orders o, jsonb_array_elements(o.items) i
           where o.tenant = v_tenant and o.status <> 'cancelled'
             and o.created_at >= v_from and o.created_at < v_to
           group by 1
           order by 2 desc, 1
           limit 5
        ) t
    ), '[]'::jsonb),
    'low_stock', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'left', left_qty) order by left_qty, name)
        from (
          select p.name, p.stock_quantity as left_qty
            from products p
           where p.tenant = v_tenant and p.is_available and p.stock_quantity <= 5
             and not exists (select 1 from product_variants v where v.product_id = p.id and v.tenant = v_tenant)
          union all
          select p.name || ' — ' || v.label, v.stock_quantity
            from product_variants v join products p on p.id = v.product_id and p.tenant = v_tenant
           where v.tenant = v_tenant and p.is_available and v.is_available and v.stock_quantity <= 5
           order by 2, 1
           limit 10
        ) s
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.counter_set_stock(uuid, uuid, integer, text, text),
  public.store_today_summary() from public, anon;
grant execute on function public.counter_set_stock(uuid, uuid, integer, text, text),
  public.store_today_summary() to authenticated;
