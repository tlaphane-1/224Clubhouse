-- ============================================================
-- 224 Clubhouse — product variants (2026-10-05)
-- ============================================================
-- A product can be sold in options (1g / 3.5g / 7g, flavours, sizes), each
-- with its own price and stock.
--
-- DESIGN
-- * product_variants rows hang off products (cascade delete).
-- * A trigger keeps products.price = the cheapest AVAILABLE option and
--   products.stock_quantity = the sum of available options' stock. Listings,
--   sorting, "out of stock" badges, low-stock reports and the cart clamp keep
--   reading the product row unchanged. A product with NO variants behaves
--   exactly as before.
-- * place_cod_order: a line for a product that has options MUST carry
--   variant_id; price and stock come from the locked variant row. The order's
--   items jsonb gains variant_id + variant_label on those lines.
-- * admin_update_order_status: cancelling restocks the option that was sold.
-- * Lock order is products -> product_variants -> discount_codes in both
--   functions. An admin editing a variant takes variant -> product (via the
--   trigger), the reverse; a collision is a detected deadlock that aborts one
--   statement, not a hang, and is vanishingly rare at this shop's volume.
-- ============================================================

create table if not exists product_variants (
  id              uuid primary key default gen_random_uuid(),
  product_id      uuid not null references products(id) on delete cascade,
  label           text not null check (length(trim(label)) between 1 and 60),
  price           integer not null check (price >= 0),
  stock_quantity  integer not null default 0 check (stock_quantity >= 0),
  is_available    boolean not null default true,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  unique (product_id, label)
);

-- The unique (product_id, label) index already leads with product_id, so it
-- serves the FK lookups; this one serves the ordered option list.
create index if not exists product_variants_product_sort_idx
  on product_variants (product_id, sort_order);

alter table product_variants enable row level security;

-- Same shape as products: anyone may read (the storefront shows options to
-- signed-out shoppers), only admins write.
drop policy if exists "product_variants_public_select" on product_variants;
create policy "product_variants_public_select" on product_variants
  for select using (true);
drop policy if exists "product_variants_admin_insert" on product_variants;
create policy "product_variants_admin_insert" on product_variants
  for insert with check (is_admin());
drop policy if exists "product_variants_admin_update" on product_variants;
create policy "product_variants_admin_update" on product_variants
  for update using (is_admin()) with check (is_admin());
drop policy if exists "product_variants_admin_delete" on product_variants;
create policy "product_variants_admin_delete" on product_variants
  for delete using (is_admin());

-- ---- Keep the product row in step with its options --------------------
-- SECURITY DEFINER so the derived columns are maintained whoever changed the
-- variant (an admin, or place_cod_order / the restock path). It only ever
-- recomputes from product_variants, so it grants nothing new.
create or replace function sync_product_totals(p_product_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update products p
     set stock_quantity = coalesce(
           (select sum(v.stock_quantity) from product_variants v
             where v.product_id = p.id and v.is_available), 0),
         price = coalesce(
           (select min(v.price) from product_variants v
             where v.product_id = p.id and v.is_available), p.price)
   where p.id = p_product_id
     -- No options left: the product keeps its last values and is edited by
     -- hand again, as before variants existed.
     and exists (select 1 from product_variants v where v.product_id = p.id);
$$;

revoke execute on function sync_product_totals(uuid) from public, anon, authenticated;

create or replace function sync_product_from_variants()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op <> 'INSERT' then
    perform sync_product_totals(old.product_id);
  end if;
  if tg_op <> 'DELETE' and (tg_op = 'INSERT' or new.product_id is distinct from old.product_id) then
    perform sync_product_totals(new.product_id);
  end if;
  return null;
end;
$$;

revoke execute on function sync_product_from_variants() from public, anon, authenticated;

drop trigger if exists product_variants_sync on product_variants;
create trigger product_variants_sync
  after insert or update or delete on product_variants
  for each row execute function sync_product_from_variants();

-- ---- place_cod_order --------------------------------------------------
-- Body is 20261001120000 verbatim except the VARIANTS block in the item loop,
-- the variant-aware price/items line, and the variant-aware stock decrement.
create or replace function place_cod_order(
  p_customer        jsonb,
  p_items           jsonb,
  p_payment_method  text,
  p_discount_code   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
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
begin
  if v_uid is null then
    raise exception 'Sign in required to place an order';
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

  if p_payment_method not in ('cash_on_delivery','card_on_delivery','eft') then
    raise exception 'Invalid payment method';
  end if;
  -- MEMBERSHIP REQUIRED AFTER THE FIRST ORDER. "Applied" is enough (pending
  -- or active-unexpired) — admins approve once payment is received. Race-free
  -- under the advisory lock above. The message is prefixed so the frontend
  -- can recognise it and show the become-a-member prompt.
  if exists (
    select 1 from orders o where o.user_id = v_uid and o.status <> 'cancelled'
  ) and not exists (
    select 1 from memberships m
     where m.user_id = v_uid
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
    select * into v_prod from products where id = (v_item->>'id')::uuid for update;
    if not found then raise exception 'Product not found'; end if;
    if not v_prod.is_available then raise exception 'Product "%" is unavailable', v_prod.name; end if;
    -- VARIANTS (20261005140000). A product with options must be bought as one
    -- of them: price and stock come from the variant row, locked AFTER its
    -- product (lock order product -> variant -> discount_codes everywhere).
    v_var_id := nullif(v_item->>'variant_id', '')::uuid;
    if v_var_id is not null then
      select * into v_var from product_variants
       where id = v_var_id and product_id = v_prod.id
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
      if exists (select 1 from product_variants where product_id = v_prod.id) then
        raise exception 'Please choose an option for "%"', v_prod.name;
      end if;
      if v_prod.stock_quantity < v_qty then raise exception 'Insufficient stock for "%"', v_prod.name; end if;
      v_price := v_prod.price;
    end if;
    -- MEMBER-ONLY GATE (from 20260813150000 — unchanged)
    if v_prod.is_member_only and not exists (
      select 1 from memberships m
       where m.user_id = v_uid
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
     where m.user_id = v_uid and m.status = 'active' and m.expires_at > now()
  );
  v_shipping := case when v_is_member or v_subtotal >= 50000 then 0 else 3000 end;
  v_total := (v_subtotal - v_disc_cents) + v_shipping;

  loop
    v_number := '224-' || upper(substr(md5(gen_random_uuid()::text), 1, 6));
    exit when not exists (select 1 from orders where order_number = v_number);
  end loop;

  insert into orders (
    customer_name, customer_email, customer_phone, items, subtotal, shipping_fee,
    discount_code, discount_cents,
    total, status, payment_method, order_number, status_history, shipping_address, user_id
  ) values (
    p_customer->>'name', v_email, p_customer->>'phone', v_items, v_subtotal, v_shipping,
    v_disc_code, v_disc_cents,
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
  -- Variant lines decrement the VARIANT; the sync trigger then recomputes the
  -- product's total. Plain lines decrement the product as before.
  for v_item in select * from jsonb_array_elements(v_items) loop
    if v_item ? 'variant_id' then
      update product_variants
         set stock_quantity = stock_quantity - (v_item->>'quantity')::int
       where id = (v_item->>'variant_id')::uuid
         and stock_quantity >= (v_item->>'quantity')::int;
    else
      update products
         set stock_quantity = stock_quantity - (v_item->>'quantity')::int
       where id = (v_item->>'id')::uuid
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
  if v_disc_code is not null then
    perform 1 from discount_codes where code = v_disc_code for update;
    update discount_codes
       set times_redeemed = times_redeemed + 1
     where code = v_disc_code
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
$$;

-- create-or-replace preserves the existing grants; they are re-stated anyway so
-- this file alone describes the final privilege set. The auth.uid() check
-- inside the function stays as defense-in-depth.
revoke execute on function place_cod_order(jsonb, jsonb, text, text) from public, anon;
grant  execute on function place_cod_order(jsonb, jsonb, text, text) to authenticated;

-- ---- admin_update_order_status ----------------------------------------
-- Body is 20260814101000 verbatim except that lines are grouped by
-- (product, variant) and variant lines credit the variant.
create or replace function admin_update_order_status(p_order_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row      orders%rowtype;
  v_line     record;
  v_units    int := 0;   -- units returned to stock
  v_lines    int := 0;   -- distinct product/option lines credited
  v_missing  int := 0;   -- lines whose product no longer exists
  v_note     text;
  v_entry    jsonb;
begin
  if not is_admin() then raise exception 'Not authorized'; end if;
  if p_status not in ('pending','confirmed','preparing','out_for_delivery',
                      'paid','processing','shipped','delivered','cancelled') then
    raise exception 'Invalid status';
  end if;

  -- Lock the order FIRST: the current-status read, the restock and the status
  -- write all happen under this lock, which is what makes a double-cancel a
  -- no-op instead of a double credit (design note 2).
  select * into v_row from orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;

  if p_status = 'cancelled' and v_row.status is distinct from 'cancelled' then
    if v_row.status = 'delivered' then
      -- Design note 1: the goods left the building. Say so instead of
      -- inventing stock.
      v_note := 'stock NOT restored — order was already marked delivered; '
                || 'adjust product stock by hand if the goods came back';
    else
      -- Aggregate per product (a cart can list the same product twice) and
      -- walk them in id order so concurrent cancels lock in the same
      -- sequence. The regex filter keeps a malformed legacy line from
      -- aborting the cancellation on a uuid cast.
      for v_line in
        select (elem->>'id')::uuid as product_id,
               case when elem->>'variant_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                    then (elem->>'variant_id')::uuid end as variant_id,
               sum(greatest(0, coalesce((elem->>'quantity')::int, 0)))::int as qty
          from jsonb_array_elements(
                 case when jsonb_typeof(v_row.items) = 'array'
                      then v_row.items else '[]'::jsonb end
               ) as elem
         where elem->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         group by 1, 2
         order by 1, 2
      loop
        if v_line.qty <= 0 then
          continue;
        end if;
        -- Lock the product row so the credit can't race place_cod_order's
        -- guarded decrement of the same row.
        perform 1 from products where id = v_line.product_id for update;
        if not found then
          v_missing := v_missing + 1;   -- design note 4: skip, don't fail
          continue;
        end if;
        if v_line.variant_id is not null then
          -- Credit the option that was sold; the sync trigger recomputes the
          -- product total. A deleted option is skipped like a deleted product:
          -- crediting the product directly would be overwritten by the next sync.
          update product_variants
             set stock_quantity = stock_quantity + v_line.qty
           where id = v_line.variant_id and product_id = v_line.product_id;
          if not found then
            v_missing := v_missing + 1;
            continue;
          end if;
        else
          update products
             set stock_quantity = stock_quantity + v_line.qty
           where id = v_line.product_id;
        end if;
        v_units := v_units + v_line.qty;
        v_lines := v_lines + 1;
      end loop;

      v_note := 'stock restored: ' || v_units || ' unit(s) across '
                || v_lines || ' product(s)';
      if v_missing > 0 then
        v_note := v_note || '; ' || v_missing
                  || ' line(s) skipped — product or option no longer exists';
      end if;
    end if;
  end if;

  -- Same history idiom as admin_update_membership_status: {status, at, actor},
  -- plus a `note` on the entries where stock moved (or deliberately didn't).
  v_entry := jsonb_build_object('status', p_status, 'at', now(), 'actor', auth.uid());
  if v_note is not null then
    v_entry := v_entry || jsonb_build_object('note', v_note);
  end if;

  update orders
     set status         = p_status,
         status_history = coalesce(status_history, '[]'::jsonb) || v_entry
   where id = p_order_id
   returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id, 'status', v_row.status, 'restocked_units', v_units
  );
end;
$$;

-- create-or-replace preserves the old grants, and EXECUTE defaults to PUBLIC —
-- revoke both explicitly, then grant only to signed-in users. The is_admin()
-- check inside the function stays as the real boundary (repo idiom).
revoke execute on function admin_update_order_status(uuid, text) from public, anon;
grant  execute on function admin_update_order_status(uuid, text) to authenticated;

-- ---- Capability probe ------------------------------------------------
-- Detectable marker for the contract suite (same idiom as
-- order_cancel_restocks()).
create or replace function product_variants_applied()
returns boolean
language sql
immutable
set search_path = public
as $$ select true $$;

grant execute on function product_variants_applied() to anon, authenticated;
