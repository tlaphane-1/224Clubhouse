-- Multi-tenant phase 2, task 8: stamp the store on every new auth user, and
-- backfill every existing user to 224.
--
-- current_tenant() trusts a signed-in user's JWT app_metadata.tenant over
-- everything else, and app_metadata is not user-editable, so store isolation
-- for signed-in users rests on that claim being set once, correctly, at
-- account creation and never moved afterwards.
--
-- stamp_user_tenant() (BEFORE INSERT on auth.users) resolves the store as:
--   1. an app_metadata.tenant already on the new row (e.g. a direct SQL insert);
--   2. user_metadata.tenant: public signUp sends it as options.data, and an
--      admin-API createUser as user_metadata. The admin API inserts the row
--      WITHOUT its custom app_metadata and writes that in a later UPDATE, so
--      user_metadata is the only way an admin create can name the store at
--      insert time (Ruling 15);
--   3. default_tenant() ('224clubhouse'): today's storefront,
--      admin-create-driver and provision-admin.mjs send no tenant, so 224 is
--      unchanged.
-- An empty string counts as absent. A store with no tenants row raises
-- 'unknown tenant', which rolls back the insert: GoTrue answers "Database
-- error saving new user" and no account exists.
--
-- The stamp runs BEFORE the existing AFTER INSERT trigger on_auth_user_profile
-- (Postgres fires every BEFORE row trigger before any AFTER row trigger), so
-- profile_from_signup reads the stamped claim and puts the profile in the
-- right store with that store's minimum age. Because every new row now gets a
-- non-empty claim, and the backfill below gives every existing row one, the
-- coalesce(raw_app_meta_data->>'tenant', default_tenant()) reads added in
-- 20261102150000 always see a non-empty store.
--
-- There is deliberately NO update trigger. user_metadata stays user-editable
-- (supabase.auth.updateUser({ data })), and re-stamping on update would let a
-- user move their own account to another store. A tenant is fixed at
-- creation.
--
-- 224 is unchanged on its own: a signup with no tenant gets '224clubhouse',
-- which is what current_tenant() already resolved for a claimless user.

create or replace function public.stamp_user_tenant()
 returns trigger
 language plpgsql
 security definer
 set search_path = public
as $function$
declare
  v_tenant text := coalesce(
    nullif(new.raw_app_meta_data->>'tenant', ''),
    nullif(new.raw_user_meta_data->>'tenant', ''),
    public.default_tenant()
  );
begin
  if not exists (select 1 from public.tenants where slug = v_tenant) then
    raise exception 'unknown tenant';
  end if;
  new.raw_app_meta_data :=
    coalesce(new.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('tenant', v_tenant);
  return new;
end;
$function$;

-- Only the trigger calls it (same grants as profile_from_signup).
revoke execute on function public.stamp_user_tenant() from public, anon, authenticated;

drop trigger if exists on_auth_user_tenant on auth.users;
create trigger on_auth_user_tenant
  before insert on auth.users
  for each row execute function public.stamp_user_tenant();

-- Backfill (spec §11: inside the migration, not a script). Every existing
-- account is 224's. Only rows without a usable claim are touched, so a second
-- run changes nothing and an account that already names a store keeps it.
-- Sessions issued before this pick the claim up on their next token refresh;
-- until then current_tenant() falls back to default_tenant(), the same store.
update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"tenant":"224clubhouse"}'::jsonb
 where raw_app_meta_data->>'tenant' is null
    or raw_app_meta_data->>'tenant' = '';
