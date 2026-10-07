-- ============================================================
-- 224 Clubhouse — admins can use the driver portal (2026-10-07)
-- ============================================================
-- Owner request: admins must be able to sign in to /driver and do deliveries
-- themselves. Every admin gets a drivers row (so they can also be picked in an
-- order's Driver dropdown), now and whenever an admin is added. Disabling that
-- row under Admin -> Drivers still takes away portal access, as for anyone.
-- ============================================================

insert into drivers (user_id, full_name)
select a.id, coalesce(nullif(split_part(a.email, '@', 1), ''), 'Admin')
  from admin_users a
on conflict (user_id) do nothing;

create or replace function admin_becomes_driver()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into drivers (user_id, full_name)
  values (new.id, coalesce(nullif(split_part(new.email, '@', 1), ''), 'Admin'))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke execute on function admin_becomes_driver() from public, anon, authenticated;

drop trigger if exists admin_users_become_driver on admin_users;
create trigger admin_users_become_driver
  after insert on admin_users
  for each row execute function admin_becomes_driver();
