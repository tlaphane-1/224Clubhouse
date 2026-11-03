-- Multi-tenant phase 2, task 6: tenant-scoped SECURITY DEFINER RPCs for
-- orders, discounts, reviews, products and drivers.
--
-- These functions bypass RLS, so the task-5 policies do not protect them: every
-- table access inside them is scoped here by hand. Each body is its CURRENT
-- definition (pg_get_functiondef on a stack with every earlier migration
-- applied; identical to the final definition named in the schema inventory)
-- with only the tenant changes added:
--   * the caller's tenant is held once in v_tenant := public.current_tenant()
--     (sql-language functions call public.current_tenant() inline);
--   * every select / update / delete on a tenant table adds tenant = v_tenant,
--     and every insert stamps tenant = v_tenant;
--   * an id that belongs to another store behaves exactly like a missing id
--     (same error, or the same empty result).
-- The two trigger paths (admin_becomes_driver, and sync_product_totals under
-- the product_variants trigger) use the ROW's tenant, not current_tenant():
-- service-role writes have no tenant context and would otherwise land in 224.
--
-- create or replace keeps every signature, return type, owner, EXECUTE grant,
-- SECURITY DEFINER, volatility and `set search_path = public`.
--
-- 224 is unchanged on its own: every existing row is '224clubhouse' (task 4)
-- and current_tenant() is '224clubhouse' for every existing caller (task 3).
-- tenant_order_prefix() is '224' and tenant_min_age() is 21 for it, so order
-- numbers and the age check are exactly as before.
--
-- validate_discount_code is not redefined: it reads no table, and the
-- discount_eval it wraps is scoped below.

-- ---- place_cod_order --------------------------------------------------------
-- Tenant: products, product_variants, customer_profiles, orders, memberships
-- and discount_codes all filtered; the order is stamped. Order number prefix
-- and minimum age come from the tenants row. Either being NULL (a JWT claim
-- naming a store that does not exist) is refused outright: a NULL must never
-- skip the age check or produce a NULL order number.
-- The age message stays the literal 224 has always shown. It names no age,
-- so it is correct for every store, and the frontend strips its "Age check:"
-- prefix to show the rest.
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
  v_shipping := case when v_is_member or v_subtotal >= 50000 then 0 else 3000 end;
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
    jsonb_build_object(
      'street', p_customer->>'street', 'apartment', p_customer->>'apartment',
      'city', p_customer->>'city', 'province', p_customer->>'province',
      'postalCode', p_customer->>'postalCode'
    ),
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

-- ---- get_order_tracking -----------------------------------------------------
-- Another store's order returns NULL, the same as a wrong number or email.
create or replace function public.get_order_tracking(p_order_number text, p_email text)
 returns jsonb
 language sql
 stable security definer
 set search_path = public
as $function$
  select jsonb_build_object(
    'order_number',        o.order_number,
    'status',              o.status,
    'status_history',      o.status_history,
    'payment_method',      o.payment_method,
    'subtotal',            o.subtotal,
    'shipping_fee',        o.shipping_fee,
    'discount_code',       o.discount_code,
    'discount_cents',      coalesce(o.discount_cents, 0),
    'total',               o.total,
    'items',               o.items,
    'created_at',          o.created_at,
    'customer_first_name', split_part(o.customer_name, ' ', 1),
    'city',                o.shipping_address->>'city',
    'paid_at',             o.paid_at
  )
  from orders o
  where o.order_number = upper(trim(p_order_number))
    and lower(o.customer_email) = lower(trim(p_email))
    and o.tenant = public.current_tenant()
  limit 1;
$function$;

-- ---- admin_update_order_status ----------------------------------------------
-- Another store's order is 'Order not found'. Restock touches only this
-- store's products and options.
create or replace function public.admin_update_order_status(p_order_id uuid, p_status text)
 returns jsonb
 language plpgsql
 security definer
 set search_path = public
as $function$
declare
  v_tenant   text := public.current_tenant();
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
  select * into v_row from orders where id = p_order_id and tenant = v_tenant for update;
  if not found then raise exception 'Order not found'; end if;

  -- EFT PAYMENT GATE (20261007120000): an unpaid EFT order can be confirmed
  -- or cancelled, but not prepared, sent out or delivered.
  if v_row.payment_method = 'eft' and v_row.paid_at is null
     and p_status in ('preparing', 'out_for_delivery', 'delivered') then
    raise exception 'EFT payment not confirmed yet: mark the payment received first';
  end if;

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
        perform 1 from products where id = v_line.product_id and tenant = v_tenant for update;
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
           where id = v_line.variant_id and product_id = v_line.product_id
             and tenant = v_tenant;
          if not found then
            v_missing := v_missing + 1;
            continue;
          end if;
        else
          update products
             set stock_quantity = stock_quantity + v_line.qty
           where id = v_line.product_id and tenant = v_tenant;
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
   where id = p_order_id and tenant = v_tenant
   returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id, 'status', v_row.status, 'restocked_units', v_units
  );
end;
$function$;

-- ---- attach_payment_proof ---------------------------------------------------
-- Another store's order is 'Order not found'. storage.objects is not a tenant
-- table; the path check already pins the file to this customer and order.
create or replace function public.attach_payment_proof(p_order_id uuid, p_path text)
 returns jsonb
 language plpgsql
 security definer
 set search_path = public
as $function$
declare
  v_uid uuid := auth.uid();
  v_tenant text := public.current_tenant();
  v_row orders%rowtype;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;

  select * into v_row from orders where id = p_order_id and tenant = v_tenant for update;
  if not found or v_row.user_id is distinct from v_uid then
    raise exception 'Order not found';
  end if;
  if v_row.payment_method <> 'eft' then raise exception 'This order is not paid by EFT'; end if;
  if v_row.status = 'cancelled' then raise exception 'This order has been cancelled'; end if;
  if v_row.paid_at is not null then raise exception 'Payment for this order is already confirmed'; end if;

  -- The path must be inside this customer's folder for this order, and the
  -- file must really be in the bucket (uploaded under the storage policy).
  if p_path is null or p_path not like (v_uid::text || '/' || p_order_id::text || '/%') then
    raise exception 'Invalid proof of payment path';
  end if;
  if not exists (
    select 1 from storage.objects
     where bucket_id = 'payment-proofs' and name = p_path
  ) then
    raise exception 'Proof of payment file not found';
  end if;

  update orders
     set payment_proof_path = p_path,
         payment_proof_uploaded_at = now()
   where id = p_order_id and tenant = v_tenant;

  return jsonb_build_object('payment_proof_uploaded_at', now());
end;
$function$;

-- ---- admin_set_eft_payment --------------------------------------------------
create or replace function public.admin_set_eft_payment(p_order_id uuid, p_received boolean, p_amount_cents integer DEFAULT NULL::integer)
 returns jsonb
 language plpgsql
 security definer
 set search_path = public
as $function$
declare
  v_tenant text := public.current_tenant();
  v_row orders%rowtype;
  v_amount int;
begin
  if not is_admin() then raise exception 'Not authorized'; end if;

  select * into v_row from orders where id = p_order_id and tenant = v_tenant for update;
  if not found then raise exception 'Order not found'; end if;
  if v_row.payment_method <> 'eft' then raise exception 'This order is not paid by EFT'; end if;

  if p_received then
    if v_row.status = 'cancelled' then raise exception 'This order has been cancelled'; end if;
    v_amount := coalesce(p_amount_cents, v_row.total);
    if v_amount < 0 then raise exception 'Amount cannot be negative'; end if;
    update orders
       set paid_at = now(),
           paid_amount_cents = v_amount,
           payment_confirmed_by = auth.uid()
     where id = p_order_id and tenant = v_tenant
     returning * into v_row;
  else
    -- Undo a mistaken confirmation. Not allowed once the goods have moved on
    -- the strength of it.
    if v_row.status in ('preparing', 'out_for_delivery', 'delivered') then
      raise exception 'Move the order back to Confirmed before undoing its payment';
    end if;
    update orders
       set paid_at = null, paid_amount_cents = null, payment_confirmed_by = null
     where id = p_order_id and tenant = v_tenant
     returning * into v_row;
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'paid_at', v_row.paid_at,
    'paid_amount_cents', v_row.paid_amount_cents,
    'short', case when v_row.paid_amount_cents is not null
                  then v_row.paid_amount_cents < v_row.total else false end
  );
end;
$function$;

-- ---- discount_eval ----------------------------------------------------------
-- The code is looked up in this store only (codes are unique per store), so
-- another store's code is 'That is not a valid code'. "First order" counts
-- only this store's orders.
create or replace function public.discount_eval(p_code text, p_subtotal_cents integer, p_uid uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path = public
as $function$
declare
  v_tenant text := public.current_tenant();
  v_code  text := upper(trim(coalesce(p_code, '')));
  v_row   discount_codes%rowtype;
  v_sub   integer := greatest(coalesce(p_subtotal_cents, 0), 0);
  v_disc  integer;
begin
  if v_code = '' then
    return jsonb_build_object('valid', false, 'reason', 'Enter a discount code');
  end if;
  -- Anti-abuse input cap, same idiom as the other RPCs. Long input can't be a
  -- real code (the column caps at 40 chars), so it gets the generic answer.
  if char_length(v_code) > 40 then
    return jsonb_build_object('valid', false, 'reason', 'That is not a valid code');
  end if;

  select * into v_row from discount_codes where code = v_code and tenant = v_tenant;

  -- A code that does not exist and a code that has been switched off get the
  -- SAME sentence, on purpose. "That code is disabled" would confirm the code
  -- exists, turning this RPC into an oracle anyone with a free account could
  -- farm for the real code list. Nothing beyond "not a valid code" is ever
  -- revealed about a code the caller has not proven they hold.
  if not found or not v_row.is_active then
    return jsonb_build_object('valid', false, 'reason', 'That is not a valid code');
  end if;

  -- From here the caller demonstrably knows a real, live code, so the
  -- remaining reasons can be specific and actionable.
  if v_row.starts_at is not null and v_row.starts_at > now() then
    return jsonb_build_object('valid', false, 'reason', 'That code is not active yet');
  end if;
  if v_row.expires_at is not null and v_row.expires_at <= now() then
    return jsonb_build_object('valid', false, 'reason', 'That code has expired');
  end if;
  if v_row.max_redemptions is not null and v_row.times_redeemed >= v_row.max_redemptions then
    return jsonb_build_object('valid', false, 'reason', 'That code has been fully redeemed');
  end if;
  if v_sub < v_row.min_subtotal_cents then
    return jsonb_build_object(
      'valid', false,
      'reason', 'Spend at least R'
                || trim(to_char(v_row.min_subtotal_cents / 100.0, 'FM9999999990.00'))
                || ' to use this code'
    );
  end if;
  if v_row.first_order_only then
    if p_uid is null then
      return jsonb_build_object('valid', false, 'reason', 'Sign in to use this code');
    end if;
    -- "First order" is measured against the ACCOUNT, which is the only
    -- identity the server trusts. Cancelled orders don't burn the code.
    -- Pre-account orders (user_id null, before 2026-08-08) are invisible here
    -- by design — they were never linked to an account, and linking them by
    -- unverified email is the account-takeover vector this project already
    -- refused once.
    if exists (
      select 1 from orders o
       where o.user_id = p_uid
         and o.tenant = v_tenant
         and o.status <> 'cancelled'
    ) then
      return jsonb_build_object('valid', false, 'reason', 'That code is for first orders only');
    end if;
  end if;

  -- Integer cents throughout. bigint intermediate so a large cart can't
  -- overflow int before the divide; integer division then truncates DOWN, so
  -- rounding always favours the business by at most one cent.
  v_disc := case v_row.kind
              when 'percent' then ((v_sub::bigint * v_row.value) / 100)::integer
              else v_row.value
            end;
  -- A fixed-amount code bigger than the cart must reduce the goods to zero,
  -- never past it — the discount must not end up paying for shipping.
  v_disc := least(greatest(v_disc, 0), v_sub);

  return jsonb_build_object(
    'valid', true,
    'code', v_row.code,
    'kind', v_row.kind,
    'value', v_row.value,
    'discount_cents', v_disc
  );
end;
$function$;

-- ---- has_delivered_purchase -------------------------------------------------
-- Only this store's delivered orders count.
create or replace function public.has_delivered_purchase(p_uid uuid, p_product_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path = public
as $function$
  select exists (
    select 1 from orders o
     where o.user_id = p_uid
       and o.tenant = public.current_tenant()
       and o.status = 'delivered'
       and o.items @> jsonb_build_array(jsonb_build_object('id', p_product_id::text))
  );
$function$;

-- ---- my_review_status -------------------------------------------------------
create or replace function public.my_review_status(p_product_id uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path = public
as $function$
declare
  v_uid uuid := auth.uid();
  v_tenant text := public.current_tenant();
  v_rev product_reviews%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('eligible', false, 'review', null);
  end if;
  select * into v_rev from product_reviews
   where product_id = p_product_id and user_id = v_uid and tenant = v_tenant;
  return jsonb_build_object(
    'eligible', has_delivered_purchase(v_uid, p_product_id),
    'review', case when found then jsonb_build_object(
      'rating', v_rev.rating, 'body', v_rev.body,
      'display_name', v_rev.display_name, 'status', v_rev.status) end
  );
end;
$function$;

-- ---- submit_product_review --------------------------------------------------
-- The review is stamped with this store. The edit path only rewrites a review
-- of this store (the unique key is still (product_id, user_id)).
create or replace function public.submit_product_review(p_product_id uuid, p_rating integer, p_body text, p_display_name text)
 returns jsonb
 language plpgsql
 security definer
 set search_path = public
as $function$
declare
  v_uid  uuid := auth.uid();
  v_tenant text := public.current_tenant();
  v_body text := trim(coalesce(p_body, ''));
  v_name text := trim(coalesce(p_display_name, ''));
begin
  if v_uid is null then raise exception 'Sign in required to leave a review'; end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be between 1 and 5';
  end if;
  if length(v_body) > 1000 then raise exception 'Review is too long (1000 characters max)'; end if;
  if length(v_name) < 1 or length(v_name) > 40 then
    raise exception 'Please give a display name (up to 40 characters)';
  end if;
  if not has_delivered_purchase(v_uid, p_product_id) then
    raise exception 'Only customers who have received this product can review it';
  end if;

  insert into product_reviews (product_id, user_id, rating, body, display_name, tenant)
  values (p_product_id, v_uid, p_rating, v_body, v_name, v_tenant)
  on conflict (product_id, user_id) do update
     set rating = excluded.rating,
         body = excluded.body,
         display_name = excluded.display_name,
         -- An edited review is re-moderated.
         status = 'pending',
         updated_at = now(),
         moderated_at = null
   where product_reviews.tenant = v_tenant;

  return jsonb_build_object('status', 'pending');
end;
$function$;

-- ---- get_product_reviews ----------------------------------------------------
create or replace function public.get_product_reviews(p_product_id uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path = public
as $function$
  select jsonb_build_object(
    'count',   (select count(*) from product_reviews
                 where product_id = p_product_id and status = 'approved'
                   and tenant = public.current_tenant()),
    'average', (select round(avg(rating)::numeric, 1) from product_reviews
                 where product_id = p_product_id and status = 'approved'
                   and tenant = public.current_tenant()),
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object(
               'display_name', r.display_name, 'rating', r.rating,
               'body', r.body, 'created_at', r.created_at)
             order by r.created_at desc)
        from (select * from product_reviews
               where product_id = p_product_id and status = 'approved'
                 and tenant = public.current_tenant()
               order by created_at desc
               limit 50) r
    ), '[]'::jsonb)
  );
$function$;

-- ---- sync_product_totals ----------------------------------------------------
-- Runs from the product_variants trigger, which service-role writes fire with
-- no tenant context, so it scopes to the PRODUCT ROW's tenant, never
-- current_tenant(). An option row from another store that points at this
-- product is ignored. plpgsql (was sql) only so the tenant can be held in
-- v_tenant; still SECURITY DEFINER, volatile, void.
create or replace function public.sync_product_totals(p_product_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path = public
as $function$
declare
  v_tenant text;
begin
  select tenant into v_tenant from products where id = p_product_id;
  if not found then
    return;
  end if;

  update products p
     set stock_quantity = coalesce(
           (select sum(v.stock_quantity) from product_variants v
             where v.product_id = p.id and v.tenant = v_tenant and v.is_available), 0),
         price = coalesce(
           (select min(v.price) from product_variants v
             where v.product_id = p.id and v.tenant = v_tenant and v.is_available), p.price)
   where p.id = p_product_id
     and p.tenant = v_tenant
     -- No options left: the product keeps its last values and is edited by
     -- hand again, as before variants existed.
     and exists (
       select 1 from product_variants v where v.product_id = p.id and v.tenant = v_tenant
     );
end;
$function$;

-- sync_product_from_variants (the trigger) is not redefined: it reads no table
-- itself, only hands OLD/NEW.product_id to sync_product_totals, which scopes to
-- that product row's tenant.

-- ---- admin_assign_driver ----------------------------------------------------
-- Another store's driver is 'Driver not found or inactive'; another store's
-- order is 'Order not found'.
create or replace function public.admin_assign_driver(p_order_id uuid, p_driver_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path = public
as $function$
declare
  v_tenant text := public.current_tenant();
begin
  if not is_admin() then raise exception 'Not authorized'; end if;
  if p_driver_id is not null and not exists (
    select 1 from drivers where user_id = p_driver_id and active and tenant = v_tenant
  ) then
    raise exception 'Driver not found or inactive';
  end if;
  update orders set driver_id = p_driver_id where id = p_order_id and tenant = v_tenant;
  if not found then raise exception 'Order not found'; end if;
end;
$function$;

-- ---- admin_driver_locations -------------------------------------------------
create or replace function public.admin_driver_locations()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path = public
as $function$
declare
  v_tenant text := public.current_tenant();
begin
  if not is_admin() then raise exception 'Not authorized'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'driver_id', d.user_id, 'name', d.full_name, 'phone', d.phone,
      'lat', l.lat, 'lng', l.lng, 'accuracy_m', l.accuracy_m, 'updated_at', l.updated_at,
      'orders', coalesce((
        select jsonb_agg(o.order_number order by o.delivery_started_at)
          from orders o
         where o.driver_id = d.user_id and o.status = 'out_for_delivery'
           and o.tenant = v_tenant
      ), '[]'::jsonb)
    ) order by d.full_name)
      from drivers d
      join driver_locations l on l.driver_id = d.user_id and l.tenant = v_tenant
     where l.updated_at > now() - interval '15 minutes'
       and d.tenant = v_tenant
  ), '[]'::jsonb);
end;
$function$;

-- ---- driver_start_delivery --------------------------------------------------
create or replace function public.driver_start_delivery(p_order_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path = public
as $function$
declare
  v_uid uuid := auth.uid();
  v_tenant text := public.current_tenant();
  v_row orders%rowtype;
begin
  if not is_driver() then raise exception 'Not authorized'; end if;
  select * into v_row from orders where id = p_order_id and tenant = v_tenant for update;
  if not found or v_row.driver_id is distinct from v_uid then
    raise exception 'Order not found';
  end if;
  if v_row.status = 'out_for_delivery' then
    return jsonb_build_object('status', v_row.status);
  end if;
  if v_row.status not in ('pending', 'confirmed', 'preparing') then
    raise exception 'This order is %', v_row.status;
  end if;
  -- Same rule as admin_update_order_status: unpaid EFT doesn't leave.
  if v_row.payment_method = 'eft' and v_row.paid_at is null then
    raise exception 'EFT payment not confirmed yet — ask the club to confirm it first';
  end if;

  update orders
     set status = 'out_for_delivery',
         delivery_started_at = now(),
         status_history = coalesce(status_history, '[]'::jsonb)
           || jsonb_build_object('status', 'out_for_delivery', 'at', now(), 'actor', v_uid)
   where id = p_order_id and tenant = v_tenant;
  return jsonb_build_object('status', 'out_for_delivery');
end;
$function$;

-- ---- driver_complete_delivery -----------------------------------------------
create or replace function public.driver_complete_delivery(p_order_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path = public
as $function$
declare
  v_uid uuid := auth.uid();
  v_tenant text := public.current_tenant();
  v_row orders%rowtype;
begin
  if not is_driver() then raise exception 'Not authorized'; end if;
  select * into v_row from orders where id = p_order_id and tenant = v_tenant for update;
  if not found or v_row.driver_id is distinct from v_uid then
    raise exception 'Order not found';
  end if;
  if v_row.status = 'delivered' then
    return jsonb_build_object('status', v_row.status);
  end if;
  if v_row.status <> 'out_for_delivery' then
    raise exception 'Start the delivery first';
  end if;

  update orders
     set status = 'delivered',
         status_history = coalesce(status_history, '[]'::jsonb)
           || jsonb_build_object('status', 'delivered', 'at', now(), 'actor', v_uid)
   where id = p_order_id and tenant = v_tenant;

  -- Last delivery done: stop keeping this driver's position.
  if not exists (
    select 1 from orders
     where driver_id = v_uid and status = 'out_for_delivery' and tenant = v_tenant
  ) then
    delete from driver_locations where driver_id = v_uid and tenant = v_tenant;
  end if;
  return jsonb_build_object('status', 'delivered');
end;
$function$;

-- ---- driver_update_location -------------------------------------------------
-- The position row is stamped with this store; the upsert only rewrites a row
-- of this store (driver_locations is still keyed by driver_id alone).
create or replace function public.driver_update_location(p_lat double precision, p_lng double precision, p_accuracy real DEFAULT NULL::real, p_heading real DEFAULT NULL::real, p_speed real DEFAULT NULL::real)
 returns jsonb
 language plpgsql
 security definer
 set search_path = public
as $function$
declare
  v_uid uuid := auth.uid();
  v_tenant text := public.current_tenant();
  v_nearby uuid[];
begin
  if not is_driver() then raise exception 'Not authorized'; end if;
  if not exists (
    select 1 from orders
     where driver_id = v_uid and status = 'out_for_delivery' and tenant = v_tenant
  ) then
    delete from driver_locations where driver_id = v_uid and tenant = v_tenant;
    return jsonb_build_object('stored', false, 'nearby', '[]'::jsonb);
  end if;
  insert into driver_locations (driver_id, lat, lng, accuracy_m, heading, speed_mps, updated_at, tenant)
  values (v_uid, p_lat, p_lng, p_accuracy, p_heading, p_speed, now(), v_tenant)
  on conflict (driver_id) do update
     set lat = excluded.lat, lng = excluded.lng, accuracy_m = excluded.accuracy_m,
         heading = excluded.heading, speed_mps = excluded.speed_mps, updated_at = now()
   where driver_locations.tenant = v_tenant;

  -- NEARBY: orders that just came within 1 km, each reported once.
  with hit as (
    update orders o
       set nearby_notified_at = now()
     where o.driver_id = v_uid
       and o.tenant = v_tenant
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
$function$;

-- ---- get_delivery_location --------------------------------------------------
-- Another store's order returns NULL, the same as a wrong number or email.
create or replace function public.get_delivery_location(p_order_number text, p_email text)
 returns jsonb
 language sql
 stable security definer
 set search_path = public
as $function$
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
  join drivers d on d.user_id = o.driver_id and d.tenant = o.tenant
  join driver_locations l on l.driver_id = o.driver_id and l.tenant = o.tenant
  where o.order_number = upper(trim(p_order_number))
    and lower(o.customer_email) = lower(trim(p_email))
    and o.status = 'out_for_delivery'
    and o.tenant = public.current_tenant()
  limit 1;
$function$;

-- ---- admin_becomes_driver (trigger on admin_users insert) --------------------
-- Stamps the drivers row with the NEW admin_users row's tenant (Ruling 11):
-- admins are granted by the service role, which has no tenant context, so
-- current_tenant() would put every admin's driver row in 224.
create or replace function public.admin_becomes_driver()
 returns trigger
 language plpgsql
 security definer
 set search_path = public
as $function$
declare
  v_tenant text := new.tenant;
begin
  insert into drivers (user_id, full_name, tenant)
  values (new.id, coalesce(nullif(split_part(new.email, '@', 1), ''), 'Admin'), v_tenant)
  on conflict (user_id) do nothing;
  return new;
end;
$function$;
