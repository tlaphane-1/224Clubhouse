-- ============================================================
-- 224 Clubhouse — Membership accounts, DB-owned tiers, approval clock
-- ============================================================
-- Mirrors the customer-accounts pattern proven on orders (20260808120000):
--
-- - membership_tiers table: prices/durations/perks move out of the client
--   bundle and the plpgsql literals into data — one source of truth, admin-
--   editable. Seeded with today's three tiers (JSX and plpgsql agree:
--   daily R10/1d, weekly R30/7d, monthly R50/30d).
-- - memberships.user_id: members finally OWN their membership and can read
--   it under RLS (owner-select). Legacy rows stay user_id = null —
--   deliberately NOT backfilled (linking by unverified email is an
--   account-takeover vector, same call as orders).
-- - place_membership now requires a signed-in account: anon could previously
--   mint unlimited 'pending' rows with an unverified paystack reference.
--   Grant is authenticated-only; the account email OVERRIDES the caller's.
-- - Approval starts the clock: place_membership leaves starts_at/expires_at
--   NULL; admin_update_membership_status stamps them at the moment of
--   activation (and at RENEWAL of a lapsed row), so admin latency no longer
--   burns paid membership days.
-- - memberships.duration_days: the tier's duration is snapshotted onto the
--   row alongside the price, so editing a live tier can't shorten what an
--   already-paid pending applicant is granted at approval.
-- - No cron: membership_effective_status() computes 'expired' on read.
-- - admin_create_membership: walk-in members created directly as active.
-- - admin_link_membership_user: attaches a walk-in row to the account that
--   member later signs up with, so their paid membership works online.
-- - place_cod_order re-created with a member-only gate: is_member_only
--   products now require an active membership (section 8).
-- ============================================================

-- ---- 1. membership_tiers -----------------------------------------------
create table if not exists membership_tiers (
  id             uuid primary key default gen_random_uuid(),
  slug           text unique not null check (char_length(slug) between 1 and 50),
  name           text not null check (char_length(name) between 1 and 100),
  price_cents    integer not null check (price_cents >= 0),
  duration_days  integer not null check (duration_days > 0),
  perks          jsonb not null default '[]'::jsonb,
  is_active      boolean not null default true,
  sort_order     integer not null default 0,
  created_at     timestamptz default now()
);

alter table membership_tiers enable row level security;

-- Public may read ACTIVE tiers (the pricing page needs them logged-out);
-- admins see and manage everything (policies are permissive, so the ALL
-- policy also lets admins select inactive tiers).
drop policy if exists "membership_tiers_public_select" on membership_tiers;
create policy "membership_tiers_public_select" on membership_tiers
  for select using (is_active);
drop policy if exists "membership_tiers_admin_all" on membership_tiers;
create policy "membership_tiers_admin_all" on membership_tiers
  for all using (is_admin()) with check (is_admin());

-- Seed the three current tiers. Values verified identical in
-- src/pages/Membership.jsx TIERS and the 20260623120000 place_membership
-- literals. Perks copied from the JSX (display content, admin-editable now).
insert into membership_tiers (slug, name, price_cents, duration_days, perks, sort_order) values
  ('daily', 'Daily Pass', 1000, 1, jsonb_build_array(
    'Single-day lounge access',
    'Access to the full floor',
    'Participation in daily sessions',
    'Meet the community'
  ), 1),
  ('weekly', 'Weekly Member', 3000, 7, jsonb_build_array(
    '7-day lounge access',
    'Event invitations',
    'Member pricing on products',
    'Lounge Wi-Fi + amenities',
    'Priority seating'
  ), 2),
  ('monthly', 'Monthly Member', 5000, 30, jsonb_build_array(
    '30-day lounge access',
    'Priority event invitations',
    'Exclusive member perks',
    'Early access to product drops',
    'Member-only discounts',
    'Lounge Wi-Fi + amenities'
  ), 3)
on conflict (slug) do nothing;

-- ---- 2. memberships: ownership + tier link + approval bookkeeping -------
alter table memberships add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table memberships add column if not exists tier_id uuid references membership_tiers(id);
alter table memberships add column if not exists approved_at timestamptz;
alter table memberships add column if not exists status_history jsonb not null default '[]'::jsonb;

-- Snapshot of the tier's duration AT APPLICATION TIME, same reasoning as the
-- existing amount snapshot: tiers are admin-editable while applications sit
-- pending, so approving must grant what the member paid for, not whatever the
-- tier says today. Null on legacy rows — approval falls back to the tier.
alter table memberships add column if not exists duration_days int;

create index if not exists memberships_user_id_idx on memberships(user_id);
create index if not exists memberships_tier_id_idx on memberships(tier_id);

-- The clock now starts at APPROVAL, not application — a fresh row must not
-- default starts_at to now().
alter table memberships alter column starts_at drop default;

-- Tier names are now data (membership_tiers.slug), so the hardcoded
-- three-value check on the legacy text column would block any future tier.
-- (If the constraint was ever created under a different name this is a
-- no-op; the three seeded slugs still pass the old check regardless.)
alter table memberships drop constraint if exists memberships_tier_check;

-- Belt-and-braces for the RPC's dedupe check: at most ONE pending
-- application per account, enforced even under concurrent requests.
-- Legacy rows (user_id null) are exempt.
create unique index if not exists memberships_one_pending_per_user
  on memberships(user_id) where (status = 'pending' and user_id is not null);

-- Owners read their OWN membership. Anon still reads nothing (auth.uid() is
-- null for anon), and the admin select/update/delete policies from
-- 20260604120000 remain in force untouched.
drop policy if exists "memberships_owner_select" on memberships;
create policy "memberships_owner_select" on memberships
  for select to authenticated
  using (user_id = auth.uid());

-- ---- 3. place_membership: signed-in, tier-priced, clock deferred --------
-- Same shape as 20260623120000 plus: requires auth.uid(), stamps user_id,
-- OVERRIDES email with the account's (verified) email, prices from
-- membership_tiers (active only), rejects duplicate pending/active
-- applications, and leaves starts_at/expires_at NULL until approval.
create or replace function place_membership(p_customer jsonb, p_tier text, p_reference text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_tier  membership_tiers%rowtype;
  v_id    uuid;
begin
  if v_uid is null then
    raise exception 'Sign in required to apply for membership';
  end if;
  select email into v_email from auth.users where id = v_uid;
  if coalesce(trim(v_email), '') = '' then
    raise exception 'Account has no email address';
  end if;

  select * into v_tier from membership_tiers
   where slug = p_tier and is_active
   limit 1;
  if not found then raise exception 'Invalid tier'; end if;

  if coalesce(trim(p_customer->>'full_name'), '') = ''
     or coalesce(trim(p_customer->>'phone'), '') = ''
     or coalesce(trim(p_customer->>'date_of_birth'), '') = '' then
    raise exception 'Missing required details';
  end if;
  -- Anti-abuse input caps (same idiom as contact_messages).
  if char_length(p_customer->>'full_name') > 200
     or char_length(p_customer->>'phone') > 50
     or char_length(coalesce(p_customer->>'id_number', '')) > 13
     or char_length(coalesce(p_reference, '')) > 100 then
    raise exception 'Input too long';
  end if;
  if ((p_customer->>'date_of_birth')::date) > (current_date - interval '21 years') then
    raise exception 'Must be 21 or older';
  end if;

  -- One live application per account: no second pending, and no new
  -- application while an unexpired active membership exists.
  if exists (
    select 1 from memberships m
     where m.user_id = v_uid
       and (m.status = 'pending'
            or (m.status = 'active' and (m.expires_at is null or m.expires_at > now())))
  ) then
    raise exception 'You already have a pending or active membership';
  end if;

  insert into memberships (
    full_name, email, phone, date_of_birth, id_number, tier, tier_id,
    status, amount, duration_days, paystack_reference, starts_at, expires_at,
    user_id, status_history
  ) values (
    p_customer->>'full_name', v_email, p_customer->>'phone',
    (p_customer->>'date_of_birth')::date, nullif(trim(p_customer->>'id_number'), ''),
    v_tier.slug, v_tier.id,
    -- price AND duration snapshotted together: editing the tier later must not
    -- change what this applicant paid for or how long they get.
    'pending', v_tier.price_cents, v_tier.duration_days, nullif(trim(p_reference), ''), null, null,
    v_uid,
    jsonb_build_array(jsonb_build_object('status', 'pending', 'at', now(), 'actor', v_uid))
  ) returning id into v_id;

  return jsonb_build_object(
    'id', v_id, 'tier', v_tier.slug, 'amount', v_tier.price_cents, 'status', 'pending'
  );
end;
$$;

-- create-or-replace preserves the old grants (which included anon), and
-- EXECUTE defaults to PUBLIC — revoke both explicitly, grant only signed-in
-- users. The auth.uid() check inside stays as defense-in-depth.
revoke execute on function place_membership(jsonb, text, text) from public, anon;
grant  execute on function place_membership(jsonb, text, text) to authenticated;

-- ---- 4. admin_update_membership_status: approval starts the clock -------
-- Same self-checking pattern as admin_update_order_status: granted to
-- authenticated, is_admin() raises inside. On activation it stamps
-- approved_at/starts_at = now() and computes expires_at from the membership's
-- snapshotted duration_days (falling back to the tier — tier_id first, then
-- legacy rows' text tier column matched against the seeded slugs). Every call
-- appends {status, at, actor} to status_history.
--
-- "Activation" deliberately includes RENEWAL: a row that says 'active' but is
-- past its expires_at reads as expired everywhere (membership_effective_status,
-- the member-only gate, the admin badge), so setting it 'active' again is a
-- renewal at the door and must restart the clock. Only an unexpired active
-- membership is left alone — re-approving it must not silently extend it.
create or replace function admin_update_membership_status(p_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row       memberships%rowtype;
  v_days      int;
  v_is_active boolean;
begin
  if not is_admin() then raise exception 'Not authorized'; end if;
  if p_status not in ('pending','active','expired','cancelled') then
    raise exception 'Invalid status';
  end if;

  select * into v_row from memberships where id = p_id for update;
  if not found then raise exception 'Membership not found'; end if;

  -- Currently a LIVE membership? (mirrors membership_effective_status: a null
  -- expires_at on an 'active' row is open-ended, not expired.)
  v_is_active := v_row.status = 'active'
                 and (v_row.expires_at is null or v_row.expires_at > now());

  if p_status = 'active' and not v_is_active then
    -- Snapshot first: the tier's duration may have been edited since.
    v_days := v_row.duration_days;
    if v_days is null then
      select t.duration_days into v_days from membership_tiers t where t.id = v_row.tier_id;
    end if;
    if v_days is null then
      -- Legacy row (no tier_id): map the text tier to the seeded slugs.
      select t.duration_days into v_days from membership_tiers t where t.slug = v_row.tier;
    end if;
    if v_days is null then
      raise exception 'Cannot determine tier duration for membership %', p_id;
    end if;

    update memberships
       set status         = 'active',
           approved_at    = now(),
           starts_at      = now(),
           expires_at     = now() + (v_days || ' days')::interval,
           status_history = coalesce(status_history, '[]'::jsonb)
                            || jsonb_build_object('status', 'active', 'at', now(), 'actor', auth.uid())
     where id = p_id
     returning * into v_row;
  else
    update memberships
       set status         = p_status,
           status_history = coalesce(status_history, '[]'::jsonb)
                            || jsonb_build_object('status', p_status, 'at', now(), 'actor', auth.uid())
     where id = p_id
     returning * into v_row;
  end if;

  return jsonb_build_object(
    'id', v_row.id, 'status', v_row.status,
    'starts_at', v_row.starts_at, 'expires_at', v_row.expires_at
  );
end;
$$;

revoke execute on function admin_update_membership_status(uuid, text) from public, anon;
grant  execute on function admin_update_membership_status(uuid, text) to authenticated;

-- ---- 5. admin_create_membership: walk-ins, active immediately -----------
-- Cash-at-the-door members have no account: created active with the clock
-- started, user_id null. If they later sign up online an admin links the row
-- to that account with admin_link_membership_user (section 6) — never
-- automatically, and never by unverified email alone.
create or replace function admin_create_membership(p_customer jsonb, p_tier_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tier membership_tiers%rowtype;
  v_id   uuid;
begin
  if not is_admin() then raise exception 'Not authorized'; end if;

  select * into v_tier from membership_tiers
   where slug = p_tier_slug and is_active
   limit 1;
  if not found then raise exception 'Invalid tier'; end if;

  if coalesce(trim(p_customer->>'full_name'), '') = ''
     or coalesce(trim(p_customer->>'email'), '') = ''
     or coalesce(trim(p_customer->>'phone'), '') = ''
     or coalesce(trim(p_customer->>'date_of_birth'), '') = '' then
    raise exception 'Missing required details';
  end if;
  if (p_customer->>'email') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Invalid email address';
  end if;
  if char_length(p_customer->>'full_name') > 200
     or char_length(p_customer->>'email') > 320
     or char_length(p_customer->>'phone') > 50
     or char_length(coalesce(p_customer->>'id_number', '')) > 13 then
    raise exception 'Input too long';
  end if;
  if ((p_customer->>'date_of_birth')::date) > (current_date - interval '21 years') then
    raise exception 'Must be 21 or older';
  end if;

  insert into memberships (
    full_name, email, phone, date_of_birth, id_number, tier, tier_id,
    status, amount, duration_days, approved_at, starts_at, expires_at, status_history
  ) values (
    p_customer->>'full_name', p_customer->>'email', p_customer->>'phone',
    (p_customer->>'date_of_birth')::date, nullif(trim(p_customer->>'id_number'), ''),
    v_tier.slug, v_tier.id,
    -- duration snapshotted alongside the price so a later tier edit can't
    -- change this member's renewal length either.
    'active', v_tier.price_cents, v_tier.duration_days, now(), now(),
    now() + (v_tier.duration_days || ' days')::interval,
    jsonb_build_array(jsonb_build_object('status', 'active', 'at', now(), 'actor', auth.uid()))
  ) returning id into v_id;

  return jsonb_build_object(
    'id', v_id, 'tier', v_tier.slug, 'amount', v_tier.price_cents, 'status', 'active'
  );
end;
$$;

revoke execute on function admin_create_membership(jsonb, text) from public, anon;
grant  execute on function admin_create_membership(jsonb, text) to authenticated;

-- ---- 6. admin_link_membership_user: walk-in meets their online account --
-- Ownership is what makes a membership work online: owner-select RLS, the
-- member-only gate in place_cod_order and the customer UI all match on
-- user_id = auth.uid(). A walk-in row has user_id null, so once that member
-- signs up they'd be told "members only" while holding a paid membership.
-- This is the admin's manual, deliberate link — the account is resolved from
-- auth.users by email (an admin can't read auth.users directly, hence
-- SECURITY DEFINER), and the row's email is realigned to the account's so a
-- linked membership always carries the verified address, same rule
-- place_membership applies. Refuses rather than guesses: no account, already
-- linked, or a second pending application all raise a readable message.
create or replace function admin_link_membership_user(p_membership_id uuid, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_uid   uuid;
  v_acct  text;
  v_row   memberships%rowtype;
begin
  if not is_admin() then raise exception 'Not authorized'; end if;
  if v_email = '' then raise exception 'Email address required'; end if;
  if char_length(v_email) > 320 then raise exception 'Input too long'; end if;

  select u.id, u.email into v_uid, v_acct
    from auth.users u
   where lower(u.email) = v_email
   limit 1;
  if v_uid is null then
    raise exception 'No account found for % — ask the member to sign up first, then link', v_email;
  end if;

  select * into v_row from memberships where id = p_membership_id for update;
  if not found then raise exception 'Membership not found'; end if;
  if v_row.user_id is not null then
    raise exception 'This membership is already linked to an account';
  end if;

  -- memberships_one_pending_per_user is a unique index; check it here so the
  -- admin gets a sentence instead of a constraint violation.
  if v_row.status = 'pending' and exists (
    select 1 from memberships m where m.user_id = v_uid and m.status = 'pending'
  ) then
    raise exception 'That account already has a pending application';
  end if;

  update memberships
     set user_id        = v_uid,
         email          = v_acct,
         status_history = coalesce(status_history, '[]'::jsonb)
                          || jsonb_build_object(
                               'status', v_row.status, 'at', now(), 'actor', auth.uid(),
                               'note', 'linked to account ' || v_email
                             )
   where id = p_membership_id
   returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id, 'user_id', v_row.user_id, 'email', v_row.email, 'status', v_row.status
  );
end;
$$;

revoke execute on function admin_link_membership_user(uuid, text) from public, anon;
grant  execute on function admin_link_membership_user(uuid, text) to authenticated;

-- ---- 7. membership_effective_status: expiry without a cron --------------
-- Rowtype first-arg makes this a PostgREST computed column:
--   .select('*, effective_status:membership_effective_status')
-- 'active' past its expires_at reads as 'expired'; nothing to schedule,
-- nothing to drift. NOT security definer — it only sees the row it's given,
-- so RLS on the caller's select still governs visibility.
create or replace function membership_effective_status(m memberships)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when m.status = 'active' and m.expires_at is not null and m.expires_at < now()
      then 'expired'
    else m.status
  end;
$$;

grant execute on function membership_effective_status(memberships) to anon, authenticated;

-- ---- 8. place_cod_order: member-only products require an active membership
-- Products flagged is_member_only were badge-only until now — anyone could
-- buy them. The body below is the 20260808120000 definition copied VERBATIM
-- (same validation, row locking, server-side pricing, guarded decrement,
-- email override) with exactly ONE addition, marked MEMBER-ONLY GATE inside
-- the item loop: a member-only product requires the caller to hold an
-- active, unexpired membership (status 'active' AND expires_at > now(),
-- matching membership_effective_status above). Checked per row, right after
-- the lock, so the error can name the offending product.
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
    -- MEMBER-ONLY GATE (the one addition over 20260808120000)
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
