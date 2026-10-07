-- ============================================================
-- 224 Clubhouse — Telegram group alerts (2026-10-08)
-- ============================================================
-- Owner alerts also go to a Telegram group of the owner's choosing.
--
-- * The bot token is a secret: it is stored ENCRYPTED in Supabase Vault
--   (name telegram_bot_token), written only by the telegram-connect Edge
--   Function after Telegram confirms it (getMe). No client can read it.
-- * alert_settings (single row) holds the group chat id/title and which
--   alert kinds are switched on. Admins read/update it through RPCs.
-- * Edge Functions read everything they need through telegram_config()
--   (service_role only).
-- ============================================================

create table if not exists alert_settings (
  id                   int primary key default 1 check (id = 1),
  telegram_chat_id     bigint,
  telegram_chat_title  text,
  telegram_enabled     boolean not null default false,
  -- Per-kind switches. Missing key = on.
  telegram_kinds       jsonb not null default '{}'::jsonb,
  updated_at           timestamptz not null default now()
);

insert into alert_settings (id) values (1) on conflict (id) do nothing;

alter table alert_settings enable row level security;
-- No policies: RPC access only.

create or replace function admin_get_alert_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v alert_settings%rowtype;
begin
  if not is_admin() then raise exception 'Not authorized'; end if;
  select * into v from alert_settings where id = 1;
  return jsonb_build_object(
    'has_token', exists (select 1 from vault.secrets where name = 'telegram_bot_token'),
    'chat_id', v.telegram_chat_id,
    'chat_title', v.telegram_chat_title,
    'enabled', v.telegram_enabled,
    'kinds', v.telegram_kinds
  );
end;
$$;

revoke execute on function admin_get_alert_settings() from public, anon;
grant  execute on function admin_get_alert_settings() to authenticated;

-- Admin: switch the group feed on/off and set per-kind switches.
create or replace function admin_update_alert_settings(p_enabled boolean, p_kinds jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then raise exception 'Not authorized'; end if;
  if p_kinds is not null and jsonb_typeof(p_kinds) <> 'object' then
    raise exception 'Invalid alert kinds';
  end if;
  update alert_settings
     set telegram_enabled = coalesce(p_enabled, telegram_enabled),
         telegram_kinds = coalesce(p_kinds, telegram_kinds),
         updated_at = now()
   where id = 1;
end;
$$;

revoke execute on function admin_update_alert_settings(boolean, jsonb) from public, anon;
grant  execute on function admin_update_alert_settings(boolean, jsonb) to authenticated;

-- ---- Service-role only (Edge Functions) -----------------------------------

-- Store/replace the bot token in Vault. Changing bots forgets the old group.
create or replace function store_telegram_token(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_token is null or p_token !~ '^[0-9]+:[A-Za-z0-9_-]{30,}$' then
    raise exception 'That does not look like a Telegram bot token';
  end if;
  select id into v_id from vault.secrets where name = 'telegram_bot_token';
  if v_id is null then
    perform vault.create_secret(p_token, 'telegram_bot_token', 'Telegram alert bot (Admin -> Alerts)');
  else
    perform vault.update_secret(v_id, p_token);
  end if;
  update alert_settings
     set telegram_chat_id = null, telegram_chat_title = null, telegram_enabled = false, updated_at = now()
   where id = 1;
end;
$$;

revoke execute on function store_telegram_token(text) from public, anon, authenticated;
grant  execute on function store_telegram_token(text) to service_role;

create or replace function set_telegram_chat(p_chat_id bigint, p_title text)
returns void
language sql
security definer
set search_path = public
as $$
  update alert_settings
     set telegram_chat_id = p_chat_id, telegram_chat_title = left(p_title, 120),
         telegram_enabled = true, updated_at = now()
   where id = 1;
$$;

revoke execute on function set_telegram_chat(bigint, text) from public, anon, authenticated;
grant  execute on function set_telegram_chat(bigint, text) to service_role;

create or replace function telegram_config()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'token', (select decrypted_secret from vault.decrypted_secrets where name = 'telegram_bot_token'),
    'chat_id', s.telegram_chat_id,
    'enabled', s.telegram_enabled,
    'kinds', s.telegram_kinds
  )
  from alert_settings s where s.id = 1;
$$;

revoke execute on function telegram_config() from public, anon, authenticated;
grant  execute on function telegram_config() to service_role;
