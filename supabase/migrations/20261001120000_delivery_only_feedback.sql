-- ============================================================
-- 224 Clubhouse — 2026-10-01 testing feedback
-- ============================================================
-- 1. Membership prices: Daily R10, Weekly R50, Monthly R150.
--    (Applications already pending keep the price snapshotted on their row.)
-- 2. Delivery fee R80 -> R30. Free for ACTIVE members, and still free at
--    R500+ (pre-discount) for everyone.
-- 3. EFT (bank transfer) joins cash/card on delivery.
-- 4. New product category: joints.
-- 5. A customer with a previous (non-cancelled) order must have applied for
--    membership — pending or active — before placing another order.
-- ============================================================

update membership_tiers set price_cents = 1000  where slug = 'daily';
update membership_tiers set price_cents = 5000  where slug = 'weekly';
update membership_tiers set price_cents = 15000 where slug = 'monthly';

alter table orders drop constraint if exists orders_payment_method_check;
alter table orders add constraint orders_payment_method_check check (
  payment_method in ('cash_on_delivery','card_on_delivery','eft','online')
);

alter table products drop constraint if exists products_category_check;
alter table products add constraint products_category_check check (
  category in ('flower','edibles','joints','accessories','merchandise')
);

-- place_cod_order: body is 20260814110000 verbatim except the payment-method
-- whitelist, the MEMBERSHIP-REQUIRED gate, and the shipping CASE.
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
    if v_prod.stock_quantity < v_qty then raise exception 'Insufficient stock for "%"', v_prod.name; end if;
    -- MEMBER-ONLY GATE (from 20260813150000 — unchanged)
    if v_prod.is_member_only and not exists (
      select 1 from memberships m
       where m.user_id = v_uid
         and m.status = 'active'
         and m.expires_at > now()
    ) then
      raise exception 'Product "%" is for members only', v_prod.name;
    end if;
    v_subtotal := v_subtotal + v_prod.price * v_qty;
    v_items := v_items || jsonb_build_object(
      'id', v_prod.id, 'name', v_prod.name, 'price', v_prod.price,
      'quantity', v_qty, 'slug', v_prod.slug
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
  for v_item in select * from jsonb_array_elements(v_items) loop
    update products
       set stock_quantity = stock_quantity - (v_item->>'quantity')::int
     where id = (v_item->>'id')::uuid
       and stock_quantity >= (v_item->>'quantity')::int;
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
