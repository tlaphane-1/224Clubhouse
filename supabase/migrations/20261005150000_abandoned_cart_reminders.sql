-- ============================================================
-- 224 Clubhouse — abandoned-cart reminders (2026-10-05)
-- ============================================================
-- Signed-in customers' carts are saved server-side (saved_carts). Once an
-- hour pg_cron calls the send-cart-reminders Edge Function, which claims the
-- carts that qualify and emails ONE reminder per cart:
--   * last changed more than 3 hours ago, and less than 7 days ago;
--   * not reminded since it last changed (changing the cart re-arms it);
--   * no order placed by that account since the cart last changed;
--   * the customer has not opted out (customer_email_prefs).
-- Every email carries a one-click opt-out link (/unsubscribe?cart=<token>).
--
-- PRIVACY (POPIA): carts are personal data. They are owner-only under RLS,
-- deleted by the client when emptied or ordered, and purged by a daily job
-- 30 days after their last change.
--
-- The cron job authenticates to the Edge Function with a shared secret held
-- in Supabase Vault (name: cart_reminders_cron_secret) and set as the
-- function's CRON_SECRET. The secret is created OUTSIDE this file so it never
-- lands in git — see OPEN_ITEMS.md "cart reminders".
-- ============================================================

create table if not exists saved_carts (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  -- Display snapshot written by the client: [{id, variant_id?, variant_label?,
  -- name, price, quantity, image?, slug?}]. Never used for pricing — the
  -- customer's real order is priced by place_cod_order from DB rows.
  items        jsonb not null default '[]'::jsonb
               check (jsonb_typeof(items) = 'array'
                      and jsonb_array_length(items) <= 50
                      and pg_column_size(items) <= 32768),
  updated_at   timestamptz not null default now(),
  reminded_at  timestamptz
);

-- The claim query scans by age.
create index if not exists saved_carts_updated_at_idx on saved_carts (updated_at);

alter table saved_carts enable row level security;

drop policy if exists "saved_carts_owner_select" on saved_carts;
create policy "saved_carts_owner_select" on saved_carts
  for select using ((select auth.uid()) = user_id);
drop policy if exists "saved_carts_owner_insert" on saved_carts;
create policy "saved_carts_owner_insert" on saved_carts
  for insert with check ((select auth.uid()) = user_id);
drop policy if exists "saved_carts_owner_update" on saved_carts;
create policy "saved_carts_owner_update" on saved_carts
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "saved_carts_owner_delete" on saved_carts;
create policy "saved_carts_owner_delete" on saved_carts
  for delete using ((select auth.uid()) = user_id);

-- updated_at is the reminder clock, so the server owns it: a client cannot
-- back-date or future-date its own cart, and re-saving identical items does
-- not re-arm a reminder. reminded_at is pinned for CLIENT roles only; the
-- SECURITY DEFINER functions below run as the table owner and may set it.
create or replace function saved_carts_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.items is not distinct from old.items then
    new.updated_at := old.updated_at;
  else
    new.updated_at := now();
  end if;
  if current_user in ('anon', 'authenticated') then
    new.reminded_at := case when tg_op = 'INSERT' then null else old.reminded_at end;
  end if;
  return new;
end;
$$;

drop trigger if exists saved_carts_touch on saved_carts;
create trigger saved_carts_touch
  before insert or update on saved_carts
  for each row execute function saved_carts_touch();

-- ---- Opt-out ----------------------------------------------------------
-- One row per customer who has ever been sent a reminder. The token is the
-- unguessable key in the email's opt-out link; it never changes, so links in
-- old emails keep working.
create table if not exists customer_email_prefs (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  cart_reminders  boolean not null default true,
  token           uuid not null unique default gen_random_uuid(),
  updated_at      timestamptz not null default now()
);

-- No policies: nobody reads or writes this table directly. The claim
-- function (service role) and stop_cart_reminders (by token) are the only
-- ways in.
alter table customer_email_prefs enable row level security;

create or replace function stop_cart_reminders(p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update customer_email_prefs
     set cart_reminders = false, updated_at = now()
   where token = p_token;
  return found;
end;
$$;

-- Opened from an email client, usually signed out.
revoke execute on function stop_cart_reminders(uuid) from public;
grant  execute on function stop_cart_reminders(uuid) to anon, authenticated;

-- ---- Claim ------------------------------------------------------------
-- Picks the carts due a reminder, stamps them reminded_at (so a second run
-- can't pick them again) and returns what the email needs. SKIP LOCKED makes
-- overlapping runs split the work instead of double-sending. Service role
-- only: it returns customers' email addresses.
create or replace function claim_cart_reminders(p_limit int default 50)
returns table (recipient_id uuid, recipient_email text, cart_items jsonb, opt_out_token uuid)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_ids uuid[];
begin
  select array_agg(e.user_id) into v_ids
    from (
      select c.user_id
        from saved_carts c
       where c.updated_at < now() - interval '3 hours'
         and c.updated_at > now() - interval '7 days'
         and (c.reminded_at is null or c.reminded_at < c.updated_at)
         and jsonb_array_length(c.items) > 0
         and not exists (
           select 1 from customer_email_prefs p
            where p.user_id = c.user_id and not p.cart_reminders)
         and not exists (
           select 1 from orders o
            where o.user_id = c.user_id and o.created_at >= c.updated_at)
       order by c.updated_at
       limit greatest(1, least(coalesce(p_limit, 50), 200))
       for update of c skip locked
    ) e;

  if v_ids is null then
    return;
  end if;

  insert into customer_email_prefs (user_id)
  select unnest(v_ids)
  on conflict (user_id) do nothing;

  -- Runs as the owner, so saved_carts_touch lets reminded_at through (and
  -- keeps updated_at, since items are unchanged).
  update saved_carts set reminded_at = now() where user_id = any(v_ids);

  return query
    select c.user_id, u.email::text, c.items, p.token
      from saved_carts c
      join auth.users u on u.id = c.user_id
      join customer_email_prefs p on p.user_id = c.user_id
     where c.user_id = any(v_ids)
       and coalesce(u.email, '') <> '';
end;
$$;

revoke execute on function claim_cart_reminders(int) from public, anon, authenticated;
grant  execute on function claim_cart_reminders(int) to service_role;

-- Un-claims carts whose email failed to send, so the next hourly run retries
-- them. Service role only.
create or replace function release_cart_reminders(p_user_ids uuid[])
returns void
language sql
security definer
set search_path = public
as $$
  update saved_carts set reminded_at = null where user_id = any(p_user_ids);
$$;

revoke execute on function release_cart_reminders(uuid[]) from public, anon, authenticated;
grant  execute on function release_cart_reminders(uuid[]) to service_role;

-- ---- Capability probe ------------------------------------------------
create or replace function cart_reminders_applied()
returns boolean
language sql
immutable
set search_path = public
as $$ select true $$;

grant execute on function cart_reminders_applied() to anon, authenticated;

-- ---- Schedules --------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Hourly at :17 (off the top of the hour, when shared cron load peaks).
-- The URL is this project's; if the Supabase project ever changes, update it
-- here alongside BASE in src/hooks/useStorageImages.js.
select cron.unschedule(jobid) from cron.job where jobname = 'send-cart-reminders';
select cron.schedule(
  'send-cart-reminders',
  '17 * * * *',
  $cron$
  select net.http_post(
    url := 'https://aogdkqczvlffgydgxsmz.supabase.co/functions/v1/send-cart-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                         where name = 'cart_reminders_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $cron$
);

-- Daily retention purge (POPIA data minimisation).
select cron.unschedule(jobid) from cron.job where jobname = 'purge-saved-carts';
select cron.schedule(
  'purge-saved-carts',
  '40 2 * * *',
  $cron$ delete from public.saved_carts where updated_at < now() - interval '30 days'; $cron$
);
