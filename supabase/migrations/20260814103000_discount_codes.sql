-- ============================================================
-- 224 Clubhouse — Discount codes (makes WELCOME10 real)
-- ============================================================
-- The newsletter welcome email (supabase/functions/send-welcome-email) has
-- been promising "WELCOME10 — 10% OFF your first order" to every subscriber
-- while no coupon logic existed anywhere in the product. This migration makes
-- that promise true, and does it the same way every other money path in this
-- project works: the CLIENT NEVER SENDS AN AMOUNT.
--
-- Shape of the feature:
--   - discount_codes table. Admin-managed (is_admin() ALL policy) and, unlike
--     products/events/membership_tiers, NOT publicly readable: a public select
--     policy would let anyone with the anon key page through every live code
--     and its value. Customers reach codes only through an RPC that answers
--     one question about one code they already typed.
--   - discount_eval() — the single implementation of "is this code usable by
--     this user for this subtotal, and what is it worth in cents". Private.
--   - validate_discount_code() — the checkout-time preview wrapper around it,
--     granted to authenticated (checkout already requires an account).
--   - place_cod_order() — re-created to accept the CODE ONLY and re-run
--     discount_eval() against the subtotal IT computed from DB prices. There
--     is no code path anywhere by which a caller-supplied discount amount
--     reaches an order row.
--   - orders.discount_code / orders.discount_cents record what was applied.
--
-- Deliberate decisions, argued at their call sites below:
--   - Free shipping is decided on the PRE-discount subtotal (section 5).
--   - Unknown and deactivated codes return the SAME message (section 3).
--   - The discount is clamped to the subtotal, so a total can never go
--     negative and shipping is never paid for by the discount.
-- ============================================================

-- ---- 1. discount_codes --------------------------------------------------
create table if not exists discount_codes (
  id                 uuid primary key default gen_random_uuid(),
  -- Stored UPPERCASE (regex-enforced) so the unique index doubles as the
  -- case-insensitive lookup key: every reader upper()s the input first.
  code               text unique not null check (code ~ '^[A-Z0-9_-]{3,40}$'),
  description        text check (description is null or char_length(description) <= 300),
  kind               text not null check (kind in ('percent','fixed')),
  -- percent: 1-100. fixed: an amount in CENTS (money is integer cents
  -- everywhere in this project — see CLAUDE.md).
  value              integer not null check (value > 0),
  constraint discount_codes_percent_range
    check (kind <> 'percent' or value between 1 and 100),
  min_subtotal_cents integer not null default 0 check (min_subtotal_cents >= 0),
  first_order_only   boolean not null default false,
  -- null = unlimited redemptions.
  max_redemptions    integer check (max_redemptions is null or max_redemptions > 0),
  times_redeemed     integer not null default 0 check (times_redeemed >= 0),
  starts_at          timestamptz,
  expires_at         timestamptz,
  is_active          boolean not null default true,
  created_at         timestamptz default now()
);

alter table discount_codes enable row level security;

-- Admins only, for every verb. There is deliberately NO public/authenticated
-- select policy: a readable discount_codes table is an enumeration hole —
-- anyone holding the anon key (it ships in the browser bundle) could list
-- every active code and its value. Customers validate a code they already
-- know through validate_discount_code() instead, which answers about exactly
-- one code and never returns a row.
drop policy if exists "discount_codes_admin_all" on discount_codes;
create policy "discount_codes_admin_all" on discount_codes
  for all using (is_admin()) with check (is_admin());

-- Seed the code the welcome email already advertises. Idempotent so re-running
-- the migration (or a later edit to the code's terms via the admin UI) is never
-- clobbered.
insert into discount_codes (code, description, kind, value, first_order_only, is_active)
values (
  'WELCOME10',
  'Newsletter welcome gift — 10% off your first order (send-welcome-email)',
  'percent', 10, true, true
)
on conflict (code) do nothing;

-- ---- 2. orders: what was actually applied -------------------------------
-- Recorded on the row for the receipt, the admin order view and any future
-- reporting on how much a campaign cost. `subtotal` stays the pre-discount
-- goods total, so subtotal - discount_cents + shipping_fee = total.
alter table orders add column if not exists discount_code text;
alter table orders add column if not exists discount_cents integer not null default 0;

-- ---- 3. discount_eval: the ONE implementation of the rules --------------
-- Private helper. Both the checkout preview (validate_discount_code) and the
-- authoritative order-time check (place_cod_order) call this, so the two can
-- never drift into disagreeing about what a code is worth.
--
-- Takes the user id as a parameter rather than reading auth.uid() precisely
-- because place_cod_order has already resolved and validated the caller;
-- that also makes this function unsafe to expose (it would let a caller ask
-- about someone else's first-order eligibility), hence the blanket revoke.
--
-- Returns jsonb, never raises: an unusable code is a normal outcome that both
-- callers want to handle in their own way.
create or replace function discount_eval(p_code text, p_subtotal_cents integer, p_uid uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
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

  select * into v_row from discount_codes where code = v_code;

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
$$;

-- Internal only. Reachable from validate_discount_code / place_cod_order
-- because those are SECURITY DEFINER and execute as the owner.
revoke execute on function discount_eval(text, integer, uuid) from public, anon, authenticated;

-- ---- 4. validate_discount_code: the checkout preview --------------------
-- Granted to `authenticated` only. Checkout already requires an account, so
-- there is no legitimate anonymous caller — and requiring a signed-in user
-- puts a real cost on brute-forcing the code namespace through this endpoint.
--
-- Contract:
--   valid   -> {"valid":true,"code":"WELCOME10","kind":"percent",
--               "value":10,"discount_cents":1234}
--   invalid -> {"valid":false,"reason":"<sentence to show the customer>"}
--
-- The discount_cents it returns is a PREVIEW for display. place_cod_order
-- recomputes it from its own subtotal and never trusts this figure (or any
-- figure) from the client.
create or replace function validate_discount_code(p_code text, p_subtotal_cents integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('valid', false, 'reason', 'Sign in to use a discount code');
  end if;
  return discount_eval(p_code, p_subtotal_cents, v_uid);
end;
$$;

revoke execute on function validate_discount_code(text, integer) from public, anon;
grant  execute on function validate_discount_code(text, integer) to authenticated;

-- ---- 5. place_cod_order: server-side discount ---------------------------
-- The body below is the 20260813150000 definition copied VERBATIM — same
-- auth requirement, same input caps, same per-item row locking, same
-- server-side pricing, same MEMBER-ONLY GATE, same guarded stock decrement,
-- same account-email override — with exactly one feature added: an optional
-- trailing p_discount_code.
--
-- Adding a 4th parameter creates a NEW signature rather than replacing the
-- 3-argument one, and leaving both in place makes a 3-argument call ambiguous
-- (PostgreSQL cannot choose between the 3-arg function and the 4-arg one
-- whose last parameter defaults). So the old signature is dropped first. The
-- `default null` keeps every existing 3-argument caller working — including
-- the currently-deployed frontend — so DB and frontend can ship in either
-- order without a broken window.
drop function if exists place_cod_order(jsonb, jsonb, text);

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
  -- Apply click and the Place Order click.
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
  v_shipping := case when v_subtotal >= 50000 then 0 else 8000 end;
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

-- The dropped-and-recreated function starts with EXECUTE granted to PUBLIC —
-- revoke that (and anon) explicitly, then grant only to signed-in users. The
-- auth.uid() check inside the function stays as defense-in-depth.
revoke execute on function place_cod_order(jsonb, jsonb, text, text) from public, anon;
grant  execute on function place_cod_order(jsonb, jsonb, text, text) to authenticated;
