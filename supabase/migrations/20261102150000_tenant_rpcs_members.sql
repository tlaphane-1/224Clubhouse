-- Multi-tenant phase 2, task 7: tenant-scoped SECURITY DEFINER RPCs for
-- memberships, events, newsletter, saved carts, analytics, age verification
-- and owner alerts.
--
-- These functions bypass RLS, so the task-5 policies do not protect them: every
-- table access inside them is scoped here by hand. Each body is its CURRENT
-- definition (pg_get_functiondef on a stack with every earlier migration
-- applied; identical to the final definition named in the schema inventory)
-- with only the tenant changes added, in the same way as 20261102140000:
--   * the caller's tenant is held once in v_tenant := public.current_tenant()
--     (sql-language functions call public.current_tenant() inline);
--   * every select / update / delete on a tenant table adds tenant = v_tenant,
--     and every insert stamps tenant = v_tenant;
--   * an id that belongs to another store (tier, event, reservation,
--     membership, token) behaves exactly like a missing id: same error, or the
--     same empty result.
-- Row-driven paths use the ROW's tenant, never current_tenant():
-- profile_from_signup (the new auth.users row's app_metadata.tenant) and
-- event_seats_remaining (the events row it is computed for).
--
-- Minimum age: every `interval '21 years'` is now
-- make_interval(years => <the store's tenants.min_age>), and the messages that
-- name the age are built with format() so 224 (min_age 21) gets exactly
-- today's text. A NULL min age (a claim or header naming a store with no
-- tenants row) is refused with 'Unknown store'; it never skips the check.
--
-- Signups (site_analytics, daily_summary_data) are counted per store by
-- coalesce(u.raw_app_meta_data->>'tenant', public.default_tenant()): every
-- existing account has no claim and so stays 224's.
--
-- Owner alerts are per store: alert_settings is read and written by
-- tenant = v_tenant (the 224 row is unchanged), and the Telegram bot token's
-- vault name comes from the new telegram_secret_name(slug) — 224 keeps
-- 'telegram_bot_token' exactly.
--
-- create or replace keeps every signature, return type, owner, EXECUTE grant,
-- SECURITY DEFINER, volatility and `set search_path = public`.
--
-- 224 is unchanged on its own: every existing row is '224clubhouse' (task 4),
-- current_tenant() is '224clubhouse' for every existing caller (task 3),
-- including the Edge Functions (service role, no x-tenant header), and
-- tenant_min_age() is 21 for it.
--
-- Not redefined:
--   * admin_daily_summary reads no table; it calls is_admin() (tenant-aware
--     since task 5) and daily_summary_data, scoped below, in the same request,
--     so it sees the admin's store.
--   * subscribe_newsletter was scoped by 20261102120000 (task 4).

-- ---- telegram_secret_name (new) ---------------------------------------------
-- The vault secret name holding a store's Telegram bot token. 224 keeps the
-- name it has always used; every other store gets its own suffixed name, so
-- one store's token is never another store's. Pure, not SECURITY DEFINER: it
-- reads nothing. Same visibility as the other vault helpers
-- (store_telegram_token, telegram_config): service_role only. The SECURITY
-- DEFINER callers below run as the owner and need no grant.
create or replace function public.telegram_secret_name(p_slug text)
 returns text
 language sql
 immutable
 set search_path = public
as $function$
  select case when p_slug = '224clubhouse' then 'telegram_bot_token'
              else 'telegram_bot_token__' || p_slug end;
$function$;

revoke all on function public.telegram_secret_name(text) from public, anon, authenticated;
grant execute on function public.telegram_secret_name(text) to service_role;

-- ---- place_membership -------------------------------------------------------
-- Tier slugs resolve in this store only (slugs are unique per store), so
-- another store's slug is 'Invalid tier'. The age comes from the tenants row;
-- 224's text is unchanged ('Must be 21 or older'). The age statement may be
-- ticked as 'age_21' (224's form) or 'age_min' (a store-neutral form); the
-- stored consents keep whichever key was ticked, so 224's rows are as before.
-- "One live application" counts this store's memberships; the row is stamped.
create or replace function public.place_membership(p_customer jsonb, p_tier text, p_reference text)
 returns jsonb
 language plpgsql
 security definer
 set search_path = public
as $function$
declare
  v_uid        uuid := auth.uid();
  v_tenant     text := public.current_tenant();
  v_min_age    int  := public.tenant_min_age();
  v_email      text;
  v_tier       membership_tiers%rowtype;
  v_id         uuid;
  v_address    text := trim(coalesce(p_customer->>'residential_address', ''));
  v_id_number  text := trim(coalesce(p_customer->>'id_number', ''));
  v_reasons    text[];
  v_other      text := nullif(trim(coalesce(p_customer->>'consumption_other', '')), '');
  v_sig_image  text := nullif(p_customer->>'signature_image', '');
  v_sig_typed  text := nullif(trim(coalesce(p_customer->>'signature_typed', '')), '');
  v_age_key    text;
  -- The six statements on the paper form, in order.
  c_consents   constant text[] := array[
    'age_21', 'private_club', 'no_redistribution',
    'personal_use', 'code_of_conduct', 'release_liability'
  ];
begin
  if v_uid is null then
    raise exception 'Sign in required to apply for membership';
  end if;
  -- TENANT (20261102150000): fail closed on a store with no tenants row.
  if v_min_age is null then
    raise exception 'Unknown store';
  end if;
  select email into v_email from auth.users where id = v_uid;
  if coalesce(trim(v_email), '') = '' then
    raise exception 'Account has no email address';
  end if;

  select * into v_tier from membership_tiers
   where slug = p_tier and is_active and tenant = v_tenant
   limit 1;
  if not found then raise exception 'Invalid tier'; end if;

  if coalesce(trim(p_customer->>'full_name'), '') = ''
     or coalesce(trim(p_customer->>'phone'), '') = ''
     or coalesce(trim(p_customer->>'date_of_birth'), '') = ''
     or v_address = ''
     or v_id_number = '' then
    raise exception 'Missing required details';
  end if;
  -- Anti-abuse input caps (same idiom as contact_messages).
  if char_length(p_customer->>'full_name') > 200
     or char_length(p_customer->>'phone') > 50
     or char_length(v_id_number) > 20
     or char_length(v_address) > 500
     or char_length(coalesce(v_other, '')) > 200
     or char_length(coalesce(v_sig_typed, '')) > 200
     or char_length(coalesce(p_reference, '')) > 100 then
    raise exception 'Input too long';
  end if;
  if ((p_customer->>'date_of_birth')::date) > (current_date - make_interval(years => v_min_age)) then
    raise exception '%', format('Must be %s or older', v_min_age);
  end if;

  -- What the applicant uses cannabis for: at least one known value.
  v_reasons := array(
    select distinct jsonb_array_elements_text(coalesce(p_customer->'consumption_reasons', '[]'::jsonb))
  );
  if cardinality(v_reasons) = 0 then
    raise exception 'Please tell us what you use cannabis for';
  end if;
  if exists (
    select 1 from unnest(v_reasons) r
     where r not in ('personal_wellness', 'recreational', 'medical', 'other')
  ) then
    raise exception 'Invalid reason';
  end if;
  if 'other' = any(v_reasons) and v_other is null then
    raise exception 'Please describe "Other"';
  end if;

  -- Every Agreement & Consent statement must be ticked. The age statement
  -- counts as ticked under 'age_21' or 'age_min'.
  if exists (
    select 1 from unnest(c_consents) k
     where coalesce((p_customer->'consents'->>k)::boolean, false) is not true
       and not (k = 'age_21'
                and coalesce((p_customer->'consents'->>'age_min')::boolean, false))
  ) then
    raise exception 'All agreement statements must be ticked';
  end if;
  v_age_key := case when coalesce((p_customer->'consents'->>'age_21')::boolean, false)
                    then 'age_21' else 'age_min' end;

  -- A signature: a drawn PNG (data URL, size-capped) or a typed name.
  if v_sig_image is null and v_sig_typed is null then
    raise exception 'Signature required';
  end if;
  if v_sig_image is not null
     and (left(v_sig_image, 22) <> 'data:image/png;base64,' or char_length(v_sig_image) > 300000) then
    raise exception 'Invalid signature';
  end if;

  -- One live application per account: no second pending, and no new
  -- application while an unexpired active membership exists.
  if exists (
    select 1 from memberships m
     where m.user_id = v_uid
       and m.tenant = v_tenant
       and (m.status = 'pending'
            or (m.status = 'active' and (m.expires_at is null or m.expires_at > now())))
  ) then
    raise exception 'You already have a pending or active membership';
  end if;

  insert into memberships (
    full_name, email, phone, date_of_birth, id_number, tier, tier_id,
    status, amount, duration_days, paystack_reference, starts_at, expires_at,
    user_id, status_history,
    residential_address, consumption_reasons, consumption_other,
    consents, signature_image, signature_typed, signed_at,
    tenant
  ) values (
    p_customer->>'full_name', v_email, p_customer->>'phone',
    (p_customer->>'date_of_birth')::date, v_id_number,
    v_tier.slug, v_tier.id,
    -- price AND duration snapshotted together: editing the tier later must not
    -- change what this applicant paid for or how long they get.
    'pending', v_tier.price_cents, v_tier.duration_days, nullif(trim(p_reference), ''), null, null,
    v_uid,
    jsonb_build_array(jsonb_build_object('status', 'pending', 'at', now(), 'actor', v_uid)),
    v_address, v_reasons, case when 'other' = any(v_reasons) then v_other end,
    (select jsonb_object_agg(case when k = 'age_21' then v_age_key else k end, true)
       from unnest(c_consents) k) || jsonb_build_object('accepted_at', now()),
    v_sig_image, v_sig_typed, now(),
    v_tenant
  ) returning id into v_id;

  return jsonb_build_object(
    'id', v_id, 'tier', v_tier.slug, 'amount', v_tier.price_cents, 'status', 'pending'
  );
end;
$function$;

-- ---- admin_update_membership_status -----------------------------------------
-- Another store's membership is 'Membership not found'. Tier fallbacks (by id,
-- then by slug) look in this store only.
create or replace function public.admin_update_membership_status(p_id uuid, p_status text)
 returns jsonb
 language plpgsql
 security definer
 set search_path = public
as $function$
declare
  v_tenant    text := public.current_tenant();
  v_row       memberships%rowtype;
  v_days      int;
  v_is_active boolean;
begin
  if not is_admin() then raise exception 'Not authorized'; end if;
  if p_status not in ('pending','active','expired','cancelled') then
    raise exception 'Invalid status';
  end if;

  select * into v_row from memberships where id = p_id and tenant = v_tenant for update;
  if not found then raise exception 'Membership not found'; end if;

  v_is_active := v_row.status = 'active'
                 and (v_row.expires_at is null or v_row.expires_at > now());

  if p_status = 'active' and not v_is_active then
    v_days := v_row.duration_days;
    if v_days is null then
      select t.duration_days into v_days from membership_tiers t
       where t.id = v_row.tier_id and t.tenant = v_tenant;
    end if;
    if v_days is null then
      select t.duration_days into v_days from membership_tiers t
       where t.slug = v_row.tier and t.tenant = v_tenant;
    end if;
    if v_days is null then
      raise exception 'Cannot determine tier duration for membership %', p_id;
    end if;

    update memberships
       set status         = 'active',
           approved_at    = now(),
           approved_by    = (select email from auth.users where id = auth.uid()),
           starts_at      = now(),
           expires_at     = now() + (v_days || ' days')::interval,
           status_history = coalesce(status_history, '[]'::jsonb)
                            || jsonb_build_object('status', 'active', 'at', now(), 'actor', auth.uid())
     where id = p_id and tenant = v_tenant
     returning * into v_row;
  else
    update memberships
       set status         = p_status,
           status_history = coalesce(status_history, '[]'::jsonb)
                            || jsonb_build_object('status', p_status, 'at', now(), 'actor', auth.uid())
     where id = p_id and tenant = v_tenant
     returning * into v_row;
  end if;

  return jsonb_build_object(
    'id', v_row.id, 'status', v_row.status,
    'starts_at', v_row.starts_at, 'expires_at', v_row.expires_at
  );
end;
$function$;

-- ---- admin_create_membership ------------------------------------------------
-- Tier slug in this store only; the store's minimum age (224's text unchanged);
-- the row is stamped.
create or replace function public.admin_create_membership(p_customer jsonb, p_tier_slug text)
 returns jsonb
 language plpgsql
 security definer
 set search_path = public
as $function$
declare
  v_tenant  text := public.current_tenant();
  v_min_age int  := public.tenant_min_age();
  v_tier    membership_tiers%rowtype;
  v_id      uuid;
begin
  if not is_admin() then raise exception 'Not authorized'; end if;
  -- TENANT (20261102150000): fail closed on a store with no tenants row.
  if v_min_age is null then
    raise exception 'Unknown store';
  end if;

  select * into v_tier from membership_tiers
   where slug = p_tier_slug and is_active and tenant = v_tenant
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
  if ((p_customer->>'date_of_birth')::date) > (current_date - make_interval(years => v_min_age)) then
    raise exception '%', format('Must be %s or older', v_min_age);
  end if;

  insert into memberships (
    full_name, email, phone, date_of_birth, id_number, tier, tier_id,
    status, amount, duration_days, approved_at, starts_at, expires_at, status_history,
    tenant
  ) values (
    p_customer->>'full_name', p_customer->>'email', p_customer->>'phone',
    (p_customer->>'date_of_birth')::date, nullif(trim(p_customer->>'id_number'), ''),
    v_tier.slug, v_tier.id,
    -- duration snapshotted alongside the price so a later tier edit can't
    -- change this member's renewal length either.
    'active', v_tier.price_cents, v_tier.duration_days, now(), now(),
    now() + (v_tier.duration_days || ' days')::interval,
    jsonb_build_array(jsonb_build_object('status', 'active', 'at', now(), 'actor', auth.uid())),
    v_tenant
  ) returning id into v_id;

  return jsonb_build_object(
    'id', v_id, 'tier', v_tier.slug, 'amount', v_tier.price_cents, 'status', 'active'
  );
end;
$function$;

-- ---- admin_link_membership_user ---------------------------------------------
-- Another store's membership is 'Membership not found'. The account must
-- belong to this store (app_metadata.tenant, no claim = 224): another store's
-- account is 'No account found …', so an admin cannot learn which addresses
-- hold an account elsewhere.
create or replace function public.admin_link_membership_user(p_membership_id uuid, p_email text)
 returns jsonb
 language plpgsql
 security definer
 set search_path = public
as $function$
declare
  v_tenant text := public.current_tenant();
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
     and coalesce(u.raw_app_meta_data->>'tenant', public.default_tenant()) = v_tenant
   limit 1;
  if v_uid is null then
    raise exception 'No account found for % — ask the member to sign up first, then link', v_email;
  end if;

  select * into v_row from memberships where id = p_membership_id and tenant = v_tenant for update;
  if not found then raise exception 'Membership not found'; end if;
  if v_row.user_id is not null then
    raise exception 'This membership is already linked to an account';
  end if;

  -- memberships_one_pending_per_user is a unique index; check it here so the
  -- admin gets a sentence instead of a constraint violation.
  if v_row.status = 'pending' and exists (
    select 1 from memberships m where m.user_id = v_uid and m.status = 'pending' and m.tenant = v_tenant
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
   where id = p_membership_id and tenant = v_tenant
   returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id, 'user_id', v_row.user_id, 'email', v_row.email, 'status', v_row.status
  );
end;
$function$;

-- ---- event_seats_remaining (computed column on events) ----------------------
-- Counts only reservations of the EVENT ROW's store, so a stray reservation
-- row from another store can never consume seats. The row's tenant, not
-- current_tenant(): PostgREST computes this for rows the caller's RLS already
-- scoped, and a service-role reader of any store still gets that store's
-- count. plpgsql (was sql) only so the tenant can be held in v_tenant; still
-- SECURITY DEFINER, stable, integer.
create or replace function public.event_seats_remaining(e events)
 returns integer
 language plpgsql
 stable security definer
 set search_path = public
as $function$
declare
  v_tenant text := e.tenant;
begin
  return case
    when e.capacity is null then null
    else greatest(
      e.capacity - coalesce((
        select sum(r.quantity) from event_reservations r
         where r.event_id = e.id and r.tenant = v_tenant
           and r.status in ('reserved','attended')
      ), 0),
      0
    )
  end;
end;
$function$;

-- ---- reserve_event_seats ----------------------------------------------------
-- Another store's event is 'Event not found'. The member gate, the
-- one-per-account check and the capacity count use this store's rows; the
-- reservation is stamped.
create or replace function public.reserve_event_seats(p_event_id uuid, p_quantity integer, p_customer jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path = public
as $function$
declare
  v_uid    uuid := auth.uid();
  v_tenant text := public.current_tenant();
  v_email  text;
  v_event  events%rowtype;
  v_qty    int  := coalesce(p_quantity, 0);
  v_taken  int;
  v_left   int;
  v_total  int;
  v_id     uuid;
begin
  if v_uid is null then
    raise exception 'Sign in required to reserve a spot';
  end if;
  select email into v_email from auth.users where id = v_uid;
  if coalesce(trim(v_email), '') = '' then
    raise exception 'Account has no email address';
  end if;

  if v_qty < 1 or v_qty > 10 then
    raise exception 'Reserve between 1 and 10 spots';
  end if;

  if coalesce(trim(p_customer->>'name'), '') = ''
     or coalesce(trim(p_customer->>'phone'), '') = '' then
    raise exception 'Missing required details';
  end if;
  -- Anti-abuse input caps (same idiom as place_membership).
  if char_length(p_customer->>'name') > 200
     or char_length(p_customer->>'phone') > 50 then
    raise exception 'Input too long';
  end if;

  -- Lock the event row: this is what serialises concurrent reservations for
  -- the same event, so the capacity count below can't be read by two
  -- transactions that then both insert.
  select * into v_event from events where id = p_event_id and tenant = v_tenant for update;
  if not found then raise exception 'Event not found'; end if;

  -- events.date is a DATE and events.time is free text ("21:00", "late"), so
  -- there is no reliable start timestamp to compare against. Today's event is
  -- therefore still reservable — which is what the door wants.
  if v_event.date < current_date then
    raise exception 'This event has already taken place';
  end if;

  -- MEMBER-ONLY GATE — the same predicate place_cod_order applies to
  -- is_member_only products (20260813150000 section 8): an ACTIVE, unexpired
  -- membership. A pending application is not membership.
  if v_event.is_members_only and not exists (
    select 1 from memberships m
     where m.user_id = v_uid
       and m.tenant = v_tenant
       and m.status = 'active'
       and m.expires_at > now()
  ) then
    raise exception 'This event is for members only';
  end if;

  -- One live reservation per account per event. Checked here so the guest gets
  -- a sentence instead of the unique-index violation.
  if exists (
    select 1 from event_reservations r
     where r.event_id = p_event_id
       and r.user_id = v_uid
       and r.tenant = v_tenant
       and r.status in ('reserved','attended')
  ) then
    raise exception 'You already have a reservation for this event';
  end if;

  if v_event.capacity is not null then
    select coalesce(sum(r.quantity), 0) into v_taken
      from event_reservations r
     where r.event_id = p_event_id
       and r.tenant = v_tenant
       and r.status in ('reserved','attended');
    v_left := greatest(v_event.capacity - v_taken, 0);
    if v_qty > v_left then
      if v_left = 0 then
        raise exception 'This event is fully booked';
      end if;
      raise exception 'Only % spot(s) left for this event', v_left;
    end if;
  end if;

  -- Price snapshotted from the event as it stands right now; a free event
  -- (ticket_price null) reserves at zero.
  v_total := coalesce(v_event.ticket_price, 0) * v_qty;

  insert into event_reservations (
    event_id, user_id, name, email, phone, quantity, status, total_cents, status_history,
    tenant
  ) values (
    p_event_id, v_uid, p_customer->>'name', v_email, p_customer->>'phone',
    v_qty, 'reserved', v_total,
    jsonb_build_array(jsonb_build_object('status', 'reserved', 'at', now(), 'actor', v_uid)),
    v_tenant
  ) returning id into v_id;

  return jsonb_build_object(
    'id', v_id,
    'event_id', p_event_id,
    'quantity', v_qty,
    'total_cents', v_total,
    'status', 'reserved'
  );
end;
$function$;

-- ---- admin_update_reservation_status ----------------------------------------
-- Another store's reservation is 'Reservation not found'.
create or replace function public.admin_update_reservation_status(p_id uuid, p_status text)
 returns jsonb
 language plpgsql
 security definer
 set search_path = public
as $function$
declare
  v_tenant text := public.current_tenant();
  v_row event_reservations%rowtype;
begin
  if not is_admin() then raise exception 'Not authorized'; end if;
  if p_status not in ('reserved','attended','cancelled') then
    raise exception 'Invalid status';
  end if;

  select * into v_row from event_reservations where id = p_id and tenant = v_tenant for update;
  if not found then raise exception 'Reservation not found'; end if;

  -- Re-instating a cancelled reservation can collide with the
  -- one-active-per-user index (the guest may have re-reserved since). Check
  -- first so the admin gets a sentence, not a constraint violation.
  if p_status = 'reserved' and v_row.status <> 'reserved'
     and v_row.user_id is not null
     and exists (
       select 1 from event_reservations r
        where r.event_id = v_row.event_id
          and r.user_id  = v_row.user_id
          and r.tenant   = v_tenant
          and r.status   = 'reserved'
          and r.id <> v_row.id
     ) then
    raise exception 'That guest already has a live reservation for this event';
  end if;

  update event_reservations
     set status         = p_status,
         status_history = coalesce(status_history, '[]'::jsonb)
                          || jsonb_build_object('status', p_status, 'at', now(), 'actor', auth.uid())
   where id = p_id and tenant = v_tenant
   returning * into v_row;

  return jsonb_build_object('id', v_row.id, 'status', v_row.status);
end;
$function$;

-- ---- unsubscribe_newsletter -------------------------------------------------
-- Another store's token is 'not_found', the same as a token that never existed.
create or replace function public.unsubscribe_newsletter(p_token uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path = public
as $function$
declare
  v_tenant text := public.current_tenant();
  v_email text;
begin
  if p_token is null then
    return jsonb_build_object('success', false, 'reason', 'not_found');
  end if;

  update newsletter_subscribers
     set unsubscribed_at = coalesce(unsubscribed_at, now())
   where unsubscribe_token = p_token
     and tenant = v_tenant
  returning email into v_email;

  if not found then
    -- Same shape and timing-insensitive wording for "never existed" and
    -- "not yours": the caller learns nothing beyond "this link does nothing".
    return jsonb_build_object('success', false, 'reason', 'not_found');
  end if;

  return jsonb_build_object('success', true, 'email', v_email);
end;
$function$;

-- ---- stop_cart_reminders ----------------------------------------------------
-- Another store's opt-out token returns false, the same as an unknown token.
create or replace function public.stop_cart_reminders(p_token uuid)
 returns boolean
 language plpgsql
 security definer
 set search_path = public
as $function$
declare
  v_tenant text := public.current_tenant();
begin
  update customer_email_prefs
     set cart_reminders = false, updated_at = now()
   where token = p_token
     and tenant = v_tenant;
  return found;
end;
$function$;

-- ---- claim_cart_reminders ---------------------------------------------------
-- Claims only this store's carts (the send-cart-reminders Edge Function calls
-- it with the service role and no header, so: 224's, as before). Opt-outs and
-- "ordered since" count this store's rows; new prefs rows are stamped.
create or replace function public.claim_cart_reminders(p_limit integer DEFAULT 50)
 returns TABLE(recipient_id uuid, recipient_email text, cart_items jsonb, opt_out_token uuid)
 language plpgsql
 security definer
 set search_path = public
as $function$
#variable_conflict use_column
declare
  v_tenant text := public.current_tenant();
  v_ids uuid[];
begin
  select array_agg(e.user_id) into v_ids
    from (
      select c.user_id
        from saved_carts c
       where c.tenant = v_tenant
         and c.updated_at < now() - interval '3 hours'
         and c.updated_at > now() - interval '7 days'
         and (c.reminded_at is null or c.reminded_at < c.updated_at)
         and jsonb_array_length(c.items) > 0
         and not exists (
           select 1 from customer_email_prefs p
            where p.user_id = c.user_id and p.tenant = v_tenant and not p.cart_reminders)
         and not exists (
           select 1 from orders o
            where o.user_id = c.user_id and o.tenant = v_tenant and o.created_at >= c.updated_at)
       order by c.updated_at
       limit greatest(1, least(coalesce(p_limit, 50), 200))
       for update of c skip locked
    ) e;

  if v_ids is null then
    return;
  end if;

  insert into customer_email_prefs (user_id, tenant)
  select unnest(v_ids), v_tenant
  on conflict (user_id) do nothing;

  -- Runs as the owner, so saved_carts_touch lets reminded_at through (and
  -- keeps updated_at, since items are unchanged).
  update saved_carts set reminded_at = now() where user_id = any(v_ids) and tenant = v_tenant;

  return query
    select c.user_id, u.email::text, c.items, p.token
      from saved_carts c
      join auth.users u on u.id = c.user_id
      join customer_email_prefs p on p.user_id = c.user_id and p.tenant = v_tenant
     where c.user_id = any(v_ids)
       and c.tenant = v_tenant
       and coalesce(u.email, '') <> '';
end;
$function$;

-- ---- release_cart_reminders -------------------------------------------------
create or replace function public.release_cart_reminders(p_user_ids uuid[])
 returns void
 language sql
 security definer
 set search_path = public
as $function$
  update saved_carts set reminded_at = null
   where user_id = any(p_user_ids) and tenant = public.current_tenant();
$function$;

-- ---- track_event ------------------------------------------------------------
-- The event is stamped with this store; the flood guard counts this store's
-- events for the visitor.
create or replace function public.track_event(p_visitor uuid, p_session uuid, p_event text, p_path text, p_source text DEFAULT NULL::text, p_device text DEFAULT NULL::text)
 returns void
 language plpgsql
 security definer
 set search_path = public
as $function$
declare
  v_tenant text := public.current_tenant();
begin
  if p_visitor is null or p_session is null then return; end if;
  if p_event not in ('page_view','add_to_cart','checkout_start','order_placed') then return; end if;
  -- Admin screens are never counted, even if a client sends them.
  if coalesce(p_path, '') like '/admin%' then return; end if;
  -- Flood guard: at most 120 events per visitor per 10 minutes.
  if (select count(*) from site_events
       where visitor_id = p_visitor and tenant = v_tenant
         and created_at > now() - interval '10 minutes') >= 120 then
    return;
  end if;

  insert into site_events (visitor_id, session_id, event, path, source, device, tenant)
  values (
    p_visitor, p_session, p_event,
    left(coalesce(nullif(trim(p_path), ''), '/'), 200),
    left(nullif(lower(trim(coalesce(p_source, ''))), ''), 40),
    case when p_device in ('mobile','tablet','desktop') then p_device end,
    v_tenant
  );
end;
$function$;

-- ---- site_analytics ---------------------------------------------------------
-- This store's events only; signups are accounts whose app_metadata.tenant is
-- this store (no claim = 224).
create or replace function public.site_analytics(p_days integer DEFAULT 7)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path = public
as $function$
declare
  v_tenant text := public.current_tenant();
  v_days  int := greatest(1, least(coalesce(p_days, 7), 400));
  v_start timestamptz := (date_trunc('day', now() at time zone 'Africa/Johannesburg')
                          - make_interval(days => v_days - 1)) at time zone 'Africa/Johannesburg';
  v_out   jsonb;
begin
  if not is_admin() then raise exception 'Not authorized'; end if;

  with ev as (
    select *, (created_at at time zone 'Africa/Johannesburg')::date as day
      from site_events where created_at >= v_start and tenant = v_tenant
  ),
  days as (
    select generate_series(
             (v_start at time zone 'Africa/Johannesburg')::date,
             (now() at time zone 'Africa/Johannesburg')::date,
             interval '1 day')::date as day
  ),
  -- First-ever event per visitor, to split new vs returning.
  firsts as (
    select visitor_id, min(created_at) as first_seen
      from site_events
     where visitor_id in (select distinct visitor_id from ev)
       and tenant = v_tenant
     group by visitor_id
  ),
  signups as (
    select (u.created_at at time zone 'Africa/Johannesburg')::date as day, count(*) as n
      from auth.users u
     where u.created_at >= v_start and u.email not like 'vitest+%'
       and coalesce(u.raw_app_meta_data->>'tenant', public.default_tenant()) = v_tenant
     group by 1
  )
  select jsonb_build_object(
    'visitors',    (select count(distinct visitor_id) from ev),
    'new_visitors',(select count(*) from firsts where first_seen >= v_start),
    'sessions',    (select count(distinct session_id) from ev),
    'page_views',  (select count(*) from ev where event = 'page_view'),
    'signups',     (select coalesce(sum(n), 0) from signups),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'day', d.day,
               'visitors', (select count(distinct visitor_id) from ev where ev.day = d.day),
               'page_views', (select count(*) from ev where ev.day = d.day and event = 'page_view'),
               'signups', coalesce((select n from signups s where s.day = d.day), 0)
             ) order by d.day), '[]'::jsonb)
        from days d
    ),
    'top_pages', (
      select coalesce(jsonb_agg(t order by t.views desc), '[]'::jsonb) from (
        select path, count(*) as views, count(distinct visitor_id) as visitors
          from ev where event = 'page_view'
         group by path order by count(*) desc limit 10
      ) t
    ),
    'sources', (
      select coalesce(jsonb_agg(t order by t.visitors desc), '[]'::jsonb) from (
        select coalesce(source, 'direct') as source, count(distinct visitor_id) as visitors
          from ev where event = 'page_view'
         group by 1 order by 2 desc limit 10
      ) t
    ),
    'devices', (
      select coalesce(jsonb_agg(t order by t.visitors desc), '[]'::jsonb) from (
        select coalesce(device, 'unknown') as device, count(distinct visitor_id) as visitors
          from ev group by 1
      ) t
    ),
    'funnel', jsonb_build_object(
      'visited',        (select count(distinct visitor_id) from ev),
      'added_to_cart',  (select count(distinct visitor_id) from ev where event = 'add_to_cart'),
      'started_checkout', (select count(distinct visitor_id) from ev where event = 'checkout_start'),
      'ordered',        (select count(distinct visitor_id) from ev where event = 'order_placed')
    )
  ) into v_out;

  return v_out;
end;
$function$;

-- ---- set_date_of_birth ------------------------------------------------------
-- The store's minimum age; 224's text is unchanged
-- ('Age check: you must be 21 or older to order'). The profile is read and
-- written in this store.
create or replace function public.set_date_of_birth(p_dob date)
 returns jsonb
 language plpgsql
 security definer
 set search_path = public
as $function$
declare
  v_uid uuid := auth.uid();
  v_tenant text := public.current_tenant();
  v_min_age int := public.tenant_min_age();
  v_existing date;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  -- TENANT (20261102150000): fail closed on a store with no tenants row.
  if v_min_age is null then
    raise exception 'Unknown store';
  end if;
  if p_dob is null or p_dob > current_date or p_dob < date '1900-01-01' then
    raise exception 'Age check: please enter a valid date of birth';
  end if;
  if p_dob > (current_date - make_interval(years => v_min_age))::date then
    raise exception '%', format('Age check: you must be %s or older to order', v_min_age);
  end if;

  select date_of_birth into v_existing from customer_profiles
   where user_id = v_uid and tenant = v_tenant;
  if found then
    if v_existing = p_dob then
      return jsonb_build_object('verified', true);
    end if;
    raise exception 'Age check: date of birth already on record — contact the club to change it';
  end if;

  insert into customer_profiles (user_id, date_of_birth, tenant) values (v_uid, p_dob, v_tenant);
  return jsonb_build_object('verified', true);
end;
$function$;

-- ---- my_age_verified --------------------------------------------------------
-- The store's minimum age and this store's profile. plpgsql (was sql) only so
-- a NULL minimum age (unknown store) raises instead of quietly comparing to
-- NULL; still SECURITY DEFINER, stable, boolean.
create or replace function public.my_age_verified()
 returns boolean
 language plpgsql
 stable security definer
 set search_path = public
as $function$
declare
  v_tenant text := public.current_tenant();
  v_min_age int := public.tenant_min_age();
begin
  if v_min_age is null then
    raise exception 'Unknown store';
  end if;
  return exists (
    select 1 from customer_profiles
     where user_id = auth.uid()
       and tenant = v_tenant
       and date_of_birth <= (current_date - make_interval(years => v_min_age))::date
  );
end;
$function$;

-- ---- profile_from_signup (trigger on auth.users insert) ---------------------
-- Inside GoTrue's insert there is no JWT and no header, so current_tenant()
-- (and the column default) would always say 224. The store comes from the NEW
-- row's app_metadata.tenant instead (no claim = 224), its minimum age from
-- that store's tenants row, and the profile is stamped with it explicitly.
-- Same shape as before for anything that does not qualify: no profile row,
-- and the account is still created. A store with no tenants row has no
-- minimum age, so it never qualifies: no profile, so no age check is passed.
create or replace function public.profile_from_signup()
 returns trigger
 language plpgsql
 security definer
 set search_path = public
as $function$
declare
  v_dob date;
  v_tenant text := coalesce(new.raw_app_meta_data->>'tenant', public.default_tenant());
  v_min_age int;
begin
  begin
    v_dob := nullif(trim(new.raw_user_meta_data->>'date_of_birth'), '')::date;
  exception when others then
    v_dob := null;
  end;
  select min_age into v_min_age from tenants where slug = v_tenant;
  if v_min_age is not null
     and v_dob is not null
     and v_dob >= date '1900-01-01'
     and v_dob <= (current_date - make_interval(years => v_min_age))::date then
    insert into customer_profiles (user_id, date_of_birth, tenant)
    values (new.id, v_dob, v_tenant)
    on conflict (user_id) do nothing;
  end if;
  return new;
exception when others then
  return new; -- a profile problem must never block account creation
end;
$function$;

-- ---- daily_summary_data -----------------------------------------------------
-- Every count is this store's. Called by send-daily-summary (service role, no
-- header: 224, as before) and by admin_daily_summary (the admin's store).
create or replace function public.daily_summary_data(p_day date)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path = public
as $function$
declare
  v_tenant text := public.current_tenant();
  v_start timestamptz := p_day::timestamp at time zone 'Africa/Johannesburg';
  v_end   timestamptz := (p_day + 1)::timestamp at time zone 'Africa/Johannesburg';
begin
  return jsonb_build_object(
    'day', p_day,
    'visitors',   (select count(distinct visitor_id) from site_events
                    where tenant = v_tenant and created_at >= v_start and created_at < v_end),
    'page_views', (select count(*) from site_events
                    where tenant = v_tenant
                      and event = 'page_view' and created_at >= v_start and created_at < v_end),
    'new_accounts', (select count(*) from auth.users u
                      where u.created_at >= v_start and u.created_at < v_end
                        and coalesce(u.email, '') not like 'vitest+%'
                        and coalesce(u.raw_app_meta_data->>'tenant', public.default_tenant()) = v_tenant),
    'orders', (select count(*) from orders
                where tenant = v_tenant
                  and created_at >= v_start and created_at < v_end
                  and status <> 'cancelled' and customer_email not like 'vitest+%'),
    'booked_cents', (select coalesce(sum(total), 0) from orders
                      where tenant = v_tenant
                        and created_at >= v_start and created_at < v_end
                        and status <> 'cancelled' and customer_email not like 'vitest+%'),
    -- Delivered YESTERDAY (by the delivered entry in status_history), whenever placed.
    'delivered', (select count(*) from orders o
                   where o.tenant = v_tenant
                     and o.status = 'delivered' and o.customer_email not like 'vitest+%'
                     and exists (select 1 from jsonb_array_elements(coalesce(o.status_history, '[]'::jsonb)) h
                                  where h->>'status' = 'delivered'
                                    and (h->>'at')::timestamptz >= v_start and (h->>'at')::timestamptz < v_end)),
    'delivered_cents', (select coalesce(sum(o.total), 0) from orders o
                   where o.tenant = v_tenant
                     and o.status = 'delivered' and o.customer_email not like 'vitest+%'
                     and exists (select 1 from jsonb_array_elements(coalesce(o.status_history, '[]'::jsonb)) h
                                  where h->>'status' = 'delivered'
                                    and (h->>'at')::timestamptz >= v_start and (h->>'at')::timestamptz < v_end)),
    -- Waiting NOW (same definition as eftState in src/utils/orderStatus.js).
    'eft_awaiting', (select count(*) from orders
                      where tenant = v_tenant
                        and payment_method = 'eft' and paid_at is null
                        and status not in ('delivered', 'cancelled')
                        and payment_proof_uploaded_at is null
                        and customer_email not like 'vitest+%'),
    'eft_proof', (select count(*) from orders
                   where tenant = v_tenant
                     and payment_method = 'eft' and paid_at is null
                     and status not in ('delivered', 'cancelled')
                     and payment_proof_uploaded_at is not null
                     and customer_email not like 'vitest+%'),
    'reviews_pending', (select count(*) from product_reviews where tenant = v_tenant and status = 'pending'),
    'memberships_pending', (select count(*) from memberships where tenant = v_tenant and status = 'pending'),
    'low_stock', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'left', left_qty) order by left_qty, name)
        from (
          select p.name, p.stock_quantity as left_qty
            from products p
           where p.tenant = v_tenant
             and p.is_available and p.stock_quantity <= 5
             and p.slug not like 'vitest-%'
             and not exists (select 1 from product_variants v where v.product_id = p.id and v.tenant = v_tenant)
          union all
          select p.name || ' — ' || v.label, v.stock_quantity
            from product_variants v join products p on p.id = v.product_id and p.tenant = v_tenant
           where v.tenant = v_tenant
             and p.is_available and v.is_available and v.stock_quantity <= 5
             and p.slug not like 'vitest-%'
           limit 30
        ) s
    ), '[]'::jsonb)
  );
end;
$function$;

-- ---- admin_get_alert_settings -----------------------------------------------
-- This store's row and this store's vault secret. A store with no row yet gets
-- the values the seeded 224 row started with: no group, alerts off, every kind
-- on ('{}': a missing key means on).
create or replace function public.admin_get_alert_settings()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path = public
as $function$
declare
  v_tenant text := public.current_tenant();
  v alert_settings%rowtype;
begin
  if not is_admin() then raise exception 'Not authorized'; end if;
  select * into v from alert_settings where tenant = v_tenant;
  if not found then
    v.telegram_enabled := false;
    v.telegram_kinds := '{}'::jsonb;
  end if;
  return jsonb_build_object(
    'has_token', exists (select 1 from vault.secrets where name = public.telegram_secret_name(v_tenant)),
    'chat_id', v.telegram_chat_id,
    'chat_title', v.telegram_chat_title,
    'enabled', v.telegram_enabled,
    'kinds', v.telegram_kinds
  );
end;
$function$;

-- ---- admin_update_alert_settings --------------------------------------------
-- This store's row. A store with no row yet gets one (column defaults: no
-- group, alerts off) before the unchanged update, so its first save is not
-- silently lost. 224's row already exists, so for 224 this is the old update.
create or replace function public.admin_update_alert_settings(p_enabled boolean, p_kinds jsonb)
 returns void
 language plpgsql
 security definer
 set search_path = public
as $function$
declare
  v_tenant text := public.current_tenant();
begin
  if not is_admin() then raise exception 'Not authorized'; end if;
  if p_kinds is not null and jsonb_typeof(p_kinds) <> 'object' then
    raise exception 'Invalid alert kinds';
  end if;
  insert into alert_settings (tenant) values (v_tenant) on conflict (tenant) do nothing;
  update alert_settings
     set telegram_enabled = coalesce(p_enabled, telegram_enabled),
         telegram_kinds = coalesce(p_kinds, telegram_kinds),
         updated_at = now()
   where tenant = v_tenant;
end;
$function$;

-- ---- store_telegram_token ---------------------------------------------------
-- This store's vault secret (telegram_secret_name: 'telegram_bot_token' for
-- 224, as before) and this store's settings row (created if missing, as in
-- admin_update_alert_settings).
create or replace function public.store_telegram_token(p_token text)
 returns void
 language plpgsql
 security definer
 set search_path = public
as $function$
declare
  v_tenant text := public.current_tenant();
  v_name text := public.telegram_secret_name(v_tenant);
  v_id uuid;
begin
  if p_token is null or p_token !~ '^[0-9]+:[A-Za-z0-9_-]{30,}$' then
    raise exception 'That does not look like a Telegram bot token';
  end if;
  select id into v_id from vault.secrets where name = v_name;
  if v_id is null then
    perform vault.create_secret(p_token, v_name, 'Telegram alert bot (Admin -> Alerts)');
  else
    perform vault.update_secret(v_id, p_token);
  end if;
  insert into alert_settings (tenant) values (v_tenant) on conflict (tenant) do nothing;
  update alert_settings
     set telegram_chat_id = null, telegram_chat_title = null, telegram_enabled = false, updated_at = now()
   where tenant = v_tenant;
end;
$function$;

-- ---- set_telegram_chat ------------------------------------------------------
-- This store's settings row (created if missing, as above).
create or replace function public.set_telegram_chat(p_chat_id bigint, p_title text)
 returns void
 language sql
 security definer
 set search_path = public
as $function$
  insert into alert_settings (tenant) values (public.current_tenant())
  on conflict (tenant) do nothing;
  update alert_settings
     set telegram_chat_id = p_chat_id, telegram_chat_title = left(p_title, 120),
         telegram_enabled = true, updated_at = now()
   where tenant = public.current_tenant();
$function$;

-- ---- telegram_config --------------------------------------------------------
-- This store's token and settings. The Edge Functions call it with the service
-- role and no header, so they get 224's, exactly as before. A store with no
-- row returns NULL, which the callers already treat as "not configured".
create or replace function public.telegram_config()
 returns jsonb
 language sql
 stable security definer
 set search_path = public
as $function$
  select jsonb_build_object(
    'token', (select decrypted_secret from vault.decrypted_secrets
               where name = public.telegram_secret_name(public.current_tenant())),
    'chat_id', s.telegram_chat_id,
    'enabled', s.telegram_enabled,
    'kinds', s.telegram_kinds
  )
  from alert_settings s where s.tenant = public.current_tenant();
$function$;
