-- ============================================================
-- 224 Clubhouse — admin access to the daily summary (2026-10-08)
-- ============================================================
-- The Dashboard's "Share on WhatsApp" button posts the same numbers as the
-- 07:00 email. daily_summary_data stays service-role only; this wrapper lets
-- an ADMIN read it for any day.
-- ============================================================

create or replace function admin_daily_summary(p_day date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_admin() then raise exception 'Not authorized'; end if;
  return daily_summary_data(coalesce(p_day, (now() at time zone 'Africa/Johannesburg')::date));
end;
$$;

revoke execute on function admin_daily_summary(date) from public, anon;
grant  execute on function admin_daily_summary(date) to authenticated;
