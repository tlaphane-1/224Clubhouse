-- ============================================================
-- 224 Clubhouse — Event reservations (reserve online, pay at the door)
-- ============================================================
-- The events page has advertised "Tickets from R150" since launch with no way
-- to buy or reserve anything. There is still no payment provider (the Paystack
-- merchant application is open), so this ships the same shape memberships did
-- in 20260813150000: RESERVE online, PAY AT THE DOOR. No card flow.
--
-- Everything here mirrors the patterns already proven on orders/memberships:
--   - event_reservations rows are OWNED by an account (user_id) and readable
--     under owner-select RLS; admins get the full door list via is_admin().
--   - There is NO insert policy. Creation goes through reserve_event_seats(),
--     a SECURITY DEFINER RPC granted to `authenticated` only, which requires
--     auth.uid(), OVERRIDES the caller's email with the verified account email,
--     prices the reservation from the event's CURRENT ticket_price, and refuses
--     past events, over-capacity requests and duplicate reservations.
--   - The members-only gate is the same predicate place_cod_order uses for
--     is_member_only products: status 'active' AND expires_at > now().
--   - admin_update_reservation_status() is the door-desk control (check people
--     in as 'attended', cancel no-shows) and appends {status, at, actor} to
--     status_history, same bookkeeping as memberships/orders.
--
-- events.capacity is added here (nullable = unlimited) so a reservation can
-- actually be limited; event_seats_remaining() exposes the REMAINING count as
-- a PostgREST computed column so the storefront can say "6 spots left" without
-- being able to read anyone's reservation row.
-- ============================================================

-- ---- 1. events.capacity -------------------------------------------------
-- Nullable on purpose: existing events (and most lounge nights) are unlimited,
-- and a NOT NULL default would silently cap them. Only a positive number means
-- "limited"; 0 would be an event nobody may attend, which is a deleted event.
alter table events add column if not exists capacity int
  check (capacity is null or capacity > 0);

-- ---- 2. event_reservations ----------------------------------------------
create table if not exists event_reservations (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references events(id) on delete cascade,
  -- on delete set null (not cascade): a deleted account must not silently
  -- shrink the door list the staff printed. Same call as orders/memberships.
  user_id        uuid references auth.users(id) on delete set null,
  name           text not null check (char_length(name) between 1 and 200),
  email          text not null check (char_length(email) between 3 and 320),
  phone          text not null check (char_length(phone) between 1 and 50),
  quantity       int  not null check (quantity between 1 and 10),
  status         text not null default 'reserved'
                   check (status in ('reserved','attended','cancelled')),
  -- Snapshot of ticket_price * quantity AT RESERVATION TIME. Same reasoning as
  -- memberships.amount: an admin may re-price the event while reservations are
  -- outstanding, and the door must charge what the guest was quoted.
  total_cents    int  not null default 0 check (total_cents >= 0),
  status_history jsonb not null default '[]'::jsonb,
  created_at     timestamptz default now()
);

create index if not exists event_reservations_event_id_idx on event_reservations(event_id);
create index if not exists event_reservations_user_id_idx  on event_reservations(user_id);

-- Belt-and-braces for the RPC's dedupe check: at most ONE live reservation per
-- account per event, enforced even under concurrent requests. Cancelled rows
-- are exempt so a guest who cancels can reserve again.
create unique index if not exists event_reservations_one_active_per_user
  on event_reservations(event_id, user_id)
  where (status = 'reserved' and user_id is not null);

alter table event_reservations enable row level security;

-- Guests read their OWN reservations. Anon reads nothing (auth.uid() is null),
-- and there is deliberately no insert/update/delete policy for customers —
-- creation is the RPC's job, status changes are the admin's.
drop policy if exists "event_reservations_owner_select" on event_reservations;
create policy "event_reservations_owner_select" on event_reservations
  for select to authenticated
  using (user_id = auth.uid());

-- The door list: name, email and phone are personal data, so only admins.
drop policy if exists "event_reservations_admin_all" on event_reservations;
create policy "event_reservations_admin_all" on event_reservations
  for all using (is_admin()) with check (is_admin());

-- ---- 3. event_seats_remaining: capacity without leaking the list ---------
-- Rowtype first-arg makes this a PostgREST computed column:
--   .select('*, seats_remaining:event_seats_remaining')
-- NULL means unlimited (no capacity set). SECURITY DEFINER because the caller
-- cannot read event_reservations — but all that crosses the boundary is one
-- integer per event, never a row, so the door list stays admin-only.
-- 'attended' rows still occupy their seats; only 'cancelled' frees them.
create or replace function event_seats_remaining(e events)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select case
    when e.capacity is null then null
    else greatest(
      e.capacity - coalesce((
        select sum(r.quantity) from event_reservations r
         where r.event_id = e.id and r.status in ('reserved','attended')
      ), 0),
      0
    )
  end;
$$;

revoke execute on function event_seats_remaining(events) from public;
grant  execute on function event_seats_remaining(events) to anon, authenticated;

-- ---- 4. reserve_event_seats: the only way a reservation is created -------
-- Signed-in only, account email authoritative, priced from the DB, capacity
-- enforced under a lock on the event row.
create or replace function reserve_event_seats(p_event_id uuid, p_quantity int, p_customer jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
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
  select * into v_event from events where id = p_event_id for update;
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
       and r.status in ('reserved','attended')
  ) then
    raise exception 'You already have a reservation for this event';
  end if;

  if v_event.capacity is not null then
    select coalesce(sum(r.quantity), 0) into v_taken
      from event_reservations r
     where r.event_id = p_event_id
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
    event_id, user_id, name, email, phone, quantity, status, total_cents, status_history
  ) values (
    p_event_id, v_uid, p_customer->>'name', v_email, p_customer->>'phone',
    v_qty, 'reserved', v_total,
    jsonb_build_array(jsonb_build_object('status', 'reserved', 'at', now(), 'actor', v_uid))
  ) returning id into v_id;

  return jsonb_build_object(
    'id', v_id,
    'event_id', p_event_id,
    'quantity', v_qty,
    'total_cents', v_total,
    'status', 'reserved'
  );
end;
$$;

-- EXECUTE defaults to PUBLIC — revoke explicitly, grant only to signed-in
-- users. The auth.uid() check inside stays as defense-in-depth.
revoke execute on function reserve_event_seats(uuid, int, jsonb) from public, anon;
grant  execute on function reserve_event_seats(uuid, int, jsonb) to authenticated;

-- ---- 5. admin_update_reservation_status: the door desk -------------------
-- Same self-checking pattern as admin_update_membership_status: granted to
-- `authenticated`, is_admin() raises inside. Used to check guests in
-- ('attended') and to release no-shows / cancellations back to capacity.
create or replace function admin_update_reservation_status(p_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row event_reservations%rowtype;
begin
  if not is_admin() then raise exception 'Not authorized'; end if;
  if p_status not in ('reserved','attended','cancelled') then
    raise exception 'Invalid status';
  end if;

  select * into v_row from event_reservations where id = p_id for update;
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
          and r.status   = 'reserved'
          and r.id <> v_row.id
     ) then
    raise exception 'That guest already has a live reservation for this event';
  end if;

  update event_reservations
     set status         = p_status,
         status_history = coalesce(status_history, '[]'::jsonb)
                          || jsonb_build_object('status', p_status, 'at', now(), 'actor', auth.uid())
   where id = p_id
   returning * into v_row;

  return jsonb_build_object('id', v_row.id, 'status', v_row.status);
end;
$$;

revoke execute on function admin_update_reservation_status(uuid, text) from public, anon;
grant  execute on function admin_update_reservation_status(uuid, text) to authenticated;
