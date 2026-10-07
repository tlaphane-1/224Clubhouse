-- ============================================================
-- 224 Clubhouse — first-party site analytics (2026-10-07)
-- ============================================================
-- Visitor numbers for the owner, without cookies or a third party.
--
-- * The browser keeps a random visitor id (localStorage) and a per-tab session
--   id (sessionStorage). Neither is linked to an account, email or IP — the
--   table has no user_id and IPs are never stored.
-- * Events: page_view, add_to_cart, checkout_start, order_placed. Admin pages
--   and admins' own browsing are not recorded (client side).
-- * Writes go through track_event only (validated, size-capped, rate-limited
--   per visitor). Nobody can read the raw table except through the admin-only
--   site_analytics() summary.
-- * Retention: rows older than 13 months are purged daily.
-- ============================================================

create table if not exists site_events (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  visitor_id    uuid not null,
  session_id    uuid not null,
  event         text not null check (event in ('page_view','add_to_cart','checkout_start','order_placed')),
  path          text not null check (length(path) <= 200),
  source        text check (length(source) <= 40),
  device        text check (device in ('mobile','tablet','desktop'))
);

create index if not exists site_events_created_at_idx on site_events (created_at);
create index if not exists site_events_visitor_idx on site_events (visitor_id, created_at);

alter table site_events enable row level security;
-- No policies: no direct reads or writes for anon/authenticated.

create or replace function track_event(
  p_visitor uuid,
  p_session uuid,
  p_event   text,
  p_path    text,
  p_source  text default null,
  p_device  text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_visitor is null or p_session is null then return; end if;
  if p_event not in ('page_view','add_to_cart','checkout_start','order_placed') then return; end if;
  -- Admin screens are never counted, even if a client sends them.
  if coalesce(p_path, '') like '/admin%' then return; end if;
  -- Flood guard: at most 120 events per visitor per 10 minutes.
  if (select count(*) from site_events
       where visitor_id = p_visitor and created_at > now() - interval '10 minutes') >= 120 then
    return;
  end if;

  insert into site_events (visitor_id, session_id, event, path, source, device)
  values (
    p_visitor, p_session, p_event,
    left(coalesce(nullif(trim(p_path), ''), '/'), 200),
    left(nullif(lower(trim(coalesce(p_source, ''))), ''), 40),
    case when p_device in ('mobile','tablet','desktop') then p_device end
  );
end;
$$;

revoke execute on function track_event(uuid, uuid, text, text, text, text) from public;
grant  execute on function track_event(uuid, uuid, text, text, text, text) to anon, authenticated;

-- Admin summary for the last p_days days (Johannesburg calendar days,
-- including today). Everything the Analytics page shows comes from here.
create or replace function site_analytics(p_days int default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days  int := greatest(1, least(coalesce(p_days, 7), 400));
  v_start timestamptz := (date_trunc('day', now() at time zone 'Africa/Johannesburg')
                          - make_interval(days => v_days - 1)) at time zone 'Africa/Johannesburg';
  v_out   jsonb;
begin
  if not is_admin() then raise exception 'Not authorized'; end if;

  with ev as (
    select *, (created_at at time zone 'Africa/Johannesburg')::date as day
      from site_events where created_at >= v_start
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
     group by visitor_id
  ),
  signups as (
    select (created_at at time zone 'Africa/Johannesburg')::date as day, count(*) as n
      from auth.users
     where created_at >= v_start and email not like 'vitest+%'
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
$$;

revoke execute on function site_analytics(int) from public, anon;
grant  execute on function site_analytics(int) to authenticated;

-- Retention: 13 months.
select cron.unschedule(jobid) from cron.job where jobname = 'purge-site-events';
select cron.schedule(
  'purge-site-events',
  '50 2 * * *',
  $cron$ delete from public.site_events where created_at < now() - interval '13 months'; $cron$
);
