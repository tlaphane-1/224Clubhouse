-- ============================================================
-- 224 Clubhouse — server-side 21+ age verification (2026-10-08)
-- ============================================================
-- The 21+ gate used to be a localStorage tick-box only. Now:
-- * customer_profiles holds each account's date of birth (owner-readable,
--   written only through set_date_of_birth or the signup trigger).
-- * Signup sends date_of_birth in user metadata; a trigger copies it into
--   customer_profiles when valid and 21+ (it never raises — a bad value just
--   means the customer is asked again at checkout).
-- * place_cod_order refuses an account without a 21+ date of birth on record.
--   Errors are prefixed 'Age check:' so the frontend can show the DOB field.
-- * Existing members' application DOBs are backfilled.
-- ============================================================

create table if not exists customer_profiles (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  date_of_birth  date not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table customer_profiles enable row level security;

drop policy if exists "customer_profiles_owner_select" on customer_profiles;
create policy "customer_profiles_owner_select" on customer_profiles
  for select using ((select auth.uid()) = user_id);
-- No write policies: set_date_of_birth and the signup trigger only.

create or replace function set_date_of_birth(p_dob date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_existing date;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if p_dob is null or p_dob > current_date or p_dob < date '1900-01-01' then
    raise exception 'Age check: please enter a valid date of birth';
  end if;
  if p_dob > (current_date - interval '21 years')::date then
    raise exception 'Age check: you must be 21 or older to order';
  end if;

  select date_of_birth into v_existing from customer_profiles where user_id = v_uid;
  if found then
    if v_existing = p_dob then
      return jsonb_build_object('verified', true);
    end if;
    raise exception 'Age check: date of birth already on record — contact the club to change it';
  end if;

  insert into customer_profiles (user_id, date_of_birth) values (v_uid, p_dob);
  return jsonb_build_object('verified', true);
end;
$$;

revoke execute on function set_date_of_birth(date) from public, anon;
grant  execute on function set_date_of_birth(date) to authenticated;

create or replace function my_age_verified()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from customer_profiles
     where user_id = auth.uid()
       and date_of_birth <= (current_date - interval '21 years')::date
  );
$$;

revoke execute on function my_age_verified() from public, anon;
grant  execute on function my_age_verified() to authenticated;

-- Signup: copy a valid 21+ date_of_birth from user metadata. Never raises.
create or replace function profile_from_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dob date;
begin
  begin
    v_dob := nullif(trim(new.raw_user_meta_data->>'date_of_birth'), '')::date;
  exception when others then
    v_dob := null;
  end;
  if v_dob is not null
     and v_dob >= date '1900-01-01'
     and v_dob <= (current_date - interval '21 years')::date then
    insert into customer_profiles (user_id, date_of_birth)
    values (new.id, v_dob)
    on conflict (user_id) do nothing;
  end if;
  return new;
exception when others then
  return new; -- a profile problem must never block account creation
end;
$$;

revoke execute on function profile_from_signup() from public, anon, authenticated;

drop trigger if exists on_auth_user_profile on auth.users;
create trigger on_auth_user_profile
  after insert on auth.users
  for each row execute function profile_from_signup();

-- Backfill: members already gave a DOB on their application (latest one wins).
insert into customer_profiles (user_id, date_of_birth)
select distinct on (m.user_id) m.user_id, m.date_of_birth
  from memberships m
 where m.user_id is not null
   and m.date_of_birth is not null
   and m.date_of_birth <= (current_date - interval '21 years')::date
 order by m.user_id, m.created_at desc
on conflict (user_id) do nothing;

-- ---- place_cod_order --------------------------------------------------
-- Body is 20261005140000 verbatim plus the AGE CHECK block.
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

  -- AGE CHECK (20261008120000): a 21+ date of birth must be on record.
  if not exists (
    select 1 from customer_profiles
     where user_id = v_uid
       and date_of_birth <= (current_date - interval '21 years')::date
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

-- ---- Capability probe ------------------------------------------------
create or replace function age_verification_applied()
returns boolean
language sql
immutable
set search_path = public
as $$ select true $$;

grant execute on function age_verification_applied() to anon, authenticated;
