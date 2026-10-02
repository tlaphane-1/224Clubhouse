-- ============================================================
-- 224 Clubhouse — Newsletter unsubscribe (one-click, token-based)
-- ============================================================
-- Legal requirement before the first campaign goes out: every marketing mail
-- must carry a working opt-out. Design constraints:
--
--   * The link is clicked FROM AN EMAIL CLIENT, usually logged out — so the
--     RPC is granted to anon as well as authenticated.
--   * The token IS the secret. There is deliberately NO unsubscribe-by-email
--     path: with a public-insert table and no read policy, an email-keyed
--     endpoint would let anyone unsubscribe anyone (and, worse, would confirm
--     whether an address is on the list).
--   * The RPC never reveals more than "found / not found", so guessing random
--     UUIDs cannot enumerate subscribers.
--   * newsletter_subscribers keeps its admin-only SELECT policy
--     (newsletter_admin_select, migration 20260604120000). No new public read
--     is introduced here — the confirmation page learns the address only
--     because the caller already proved possession of that row's token.
--
-- Idempotent DDL throughout so re-running the migration is safe.
-- ============================================================

-- ---- 1. Schema additions ----------------------------------------------
-- Added nullable first so existing rows can be backfilled, then defaulted and
-- constrained NOT NULL. (`add column ... not null default gen_random_uuid()`
-- would also work on modern Postgres, but this order is safe on any version
-- and re-runnable.)
alter table newsletter_subscribers add column if not exists unsubscribe_token uuid;
alter table newsletter_subscribers add column if not exists unsubscribed_at   timestamptz;

update newsletter_subscribers
   set unsubscribe_token = gen_random_uuid()
 where unsubscribe_token is null;

alter table newsletter_subscribers alter column unsubscribe_token set default gen_random_uuid();
alter table newsletter_subscribers alter column unsubscribe_token set not null;

-- Unique: the token is an authentication credential for exactly one row.
create unique index if not exists newsletter_subscribers_unsubscribe_token_key
  on newsletter_subscribers (unsubscribe_token);

-- Cheap partial index for the admin list / CSV export, which reads active rows.
create index if not exists newsletter_subscribers_active_idx
  on newsletter_subscribers (subscribed_at desc)
  where unsubscribed_at is null;

comment on column newsletter_subscribers.unsubscribe_token is
  'Secret used by the /unsubscribe link. Never expose in any public read path.';
comment on column newsletter_subscribers.unsubscribed_at is
  'Set by unsubscribe_newsletter(). NULL = still subscribed. Rows are kept (not deleted) as proof of the opt-out.';

-- ---- 2. unsubscribe_newsletter — anonymous, token-authenticated --------
-- SECURITY DEFINER because anon holds no UPDATE right on the table (and must
-- not: an anon UPDATE policy would let anybody unsubscribe the whole list).
-- Pinned search_path is the standard hardening for definer functions.
--
-- Contract:
--   valid token   -> {"success": true,  "email": "…"}
--   unknown/NULL  -> {"success": false, "reason": "not_found"}
--   called twice  -> still {"success": true, …}; the original opt-out
--                    timestamp is preserved (coalesce), so re-visiting the
--                    link never looks like a failure to the customer.
create or replace function unsubscribe_newsletter(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  if p_token is null then
    return jsonb_build_object('success', false, 'reason', 'not_found');
  end if;

  update newsletter_subscribers
     set unsubscribed_at = coalesce(unsubscribed_at, now())
   where unsubscribe_token = p_token
  returning email into v_email;

  if not found then
    -- Same shape and timing-insensitive wording for "never existed" and
    -- "not yours": the caller learns nothing beyond "this link does nothing".
    return jsonb_build_object('success', false, 'reason', 'not_found');
  end if;

  return jsonb_build_object('success', true, 'email', v_email);
end;
$$;

-- Explicit grants: strip the implicit PUBLIC execute, then hand it to exactly
-- the roles that need it. anon is required — unsubscribe links are clicked
-- from an email client with no session.
revoke all on function unsubscribe_newsletter(uuid) from public;
grant execute on function unsubscribe_newsletter(uuid) to anon, authenticated, service_role;


-- ---------------------------------------------------------------------------
-- Subscribing, so that opting back in actually works.
--
-- Home.jsx used a plain insert, and `email` is unique — so anyone who
-- unsubscribed and later signed up again hit 23505, was told "You're already
-- subscribed!", and stayed off the list for good. The public insert policy
-- also cannot clear `unsubscribed_at` (no update policy, correctly), so an
-- opt-in has to go through a definer function.
--
-- Returns the same shape whether the address was new or re-subscribing; the
-- old flow already revealed list membership through its error toast, and the
-- caller here is opting IN, so there is nothing further to protect.
-- ---------------------------------------------------------------------------
create or replace function subscribe_newsletter(
  p_email text,
  p_first_name text default null,
  p_last_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  v_row newsletter_subscribers%rowtype;
begin
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'A valid email address is required';
  end if;
  if length(coalesce(p_first_name, '')) > 100 or length(coalesce(p_last_name, '')) > 100 then
    raise exception 'Name is too long';
  end if;

  insert into newsletter_subscribers (email, first_name, last_name)
  values (v_email, nullif(trim(coalesce(p_first_name, '')), ''), nullif(trim(coalesce(p_last_name, '')), ''))
  on conflict (email) do update
    set unsubscribed_at = null,
        -- Keep the details they just gave us; never blank an existing name
        -- because the re-subscribe form was left empty.
        first_name = coalesce(nullif(trim(coalesce(excluded.first_name, '')), ''), newsletter_subscribers.first_name),
        last_name  = coalesce(nullif(trim(coalesce(excluded.last_name, '')), ''), newsletter_subscribers.last_name)
  returning * into v_row;

  return jsonb_build_object('success', true, 'email', v_row.email);
end;
$$;

revoke all on function subscribe_newsletter(text, text, text) from public;
grant execute on function subscribe_newsletter(text, text, text) to anon, authenticated, service_role;
