-- ============================================================
-- 224 Clubhouse — Admin Authorization (server-side boundary)
-- ============================================================
-- Replaces the client-side VITE_ADMIN_EMAILS allowlist (UI-only, fully visible
-- in the bundle) with a real database boundary: an admin_users table + an
-- is_admin() helper that every admin-write RLS policy checks.
--
-- IMPORTANT — before `supabase db push`:
--   1. The admin's auth.users row MUST already exist (Authentication -> Users
--      in the Supabase dashboard). If it does not, the seed in section C
--      no-ops and NOBODY becomes admin — locking the admin UI and all admin
--      writes for everyone. Verify first.
--   2. Edit the email in section C to your real admin address.
--
-- NOTE: the `orders` table policy is intentionally NOT changed here. Tightening
-- orders is coupled to the server-side, payment-verified order-creation work
-- (which replaces the current anonymous client-side checkout insert and the
-- confirmation-page read). Changing it here would break live checkout with no
-- replacement. See tasks/todo.md, Workstream 2.
-- ============================================================

-- ---- A. Admin registry -------------------------------------------------
create table if not exists admin_users (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  created_at  timestamptz default now()
);

alter table admin_users enable row level security;

-- A signed-in user may read only their own admin row. There are deliberately
-- NO insert/update/delete policies, so with RLS enabled the table cannot be
-- written through the API — manage it via the dashboard or a service-role
-- script (both bypass RLS).
drop policy if exists "admin_users_self_select" on admin_users;
create policy "admin_users_self_select" on admin_users
  for select using (id = auth.uid());

-- ---- B. Helper ---------------------------------------------------------
-- SECURITY DEFINER so it reads admin_users WITHOUT triggering that table's own
-- RLS (prevents policy recursion). Pinned search_path is the standard safe
-- pattern for SECURITY DEFINER functions.
create or replace function is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from admin_users where id = auth.uid());
$$;

-- ---- C. Seed the initial admin -----------------------------------------
-- EDIT this email to your real admin address before applying. The matching
-- auth.users row must already exist (see header note).
insert into admin_users (id, email)
select id, email from auth.users
where lower(email) = lower('admin@224clubhouse.co.za')
on conflict (id) do nothing;

-- ---- D. Tighten write policies: authenticated -> is_admin() ------------

-- Products: keep public SELECT (products_public_select); admin-only writes.
drop policy if exists "products_auth_insert" on products;
drop policy if exists "products_auth_update" on products;
drop policy if exists "products_auth_delete" on products;
create policy "products_admin_insert" on products for insert with check (is_admin());
create policy "products_admin_update" on products for update using (is_admin()) with check (is_admin());
create policy "products_admin_delete" on products for delete using (is_admin());

-- Events: keep public SELECT (events_public_select); admin-only writes.
drop policy if exists "events_auth_insert" on events;
drop policy if exists "events_auth_update" on events;
drop policy if exists "events_auth_delete" on events;
create policy "events_admin_insert" on events for insert with check (is_admin());
create policy "events_admin_update" on events for update using (is_admin()) with check (is_admin());
create policy "events_admin_delete" on events for delete using (is_admin());

-- Memberships: keep public INSERT (memberships_public_insert, anyone can
-- apply); admin-only read/update/delete (rows hold POPIA-sensitive PII).
drop policy if exists "memberships_auth_select" on memberships;
drop policy if exists "memberships_auth_update" on memberships;
drop policy if exists "memberships_auth_delete" on memberships;
create policy "memberships_admin_select" on memberships for select using (is_admin());
create policy "memberships_admin_update" on memberships for update using (is_admin()) with check (is_admin());
create policy "memberships_admin_delete" on memberships for delete using (is_admin());

-- Newsletter: keep public INSERT (newsletter_public_insert); admin-only read.
drop policy if exists "newsletter_auth_select" on newsletter_subscribers;
create policy "newsletter_admin_select" on newsletter_subscribers for select using (is_admin());

-- ---- E. Storage: admin-only upload/delete (public read unchanged) ------
-- Note: ops scripts (seed/upload) use the service-role key and bypass RLS, so
-- they are unaffected. Admin UI uploads run under the admin's session.
drop policy if exists "product_images_auth_upload" on storage.objects;
drop policy if exists "product_images_auth_delete" on storage.objects;
create policy "product_images_admin_upload" on storage.objects
  for insert with check (bucket_id = 'product-images' and is_admin());
create policy "product_images_admin_delete" on storage.objects
  for delete using (bucket_id = 'product-images' and is_admin());

drop policy if exists "event_images_auth_upload" on storage.objects;
drop policy if exists "event_images_auth_delete" on storage.objects;
create policy "event_images_admin_upload" on storage.objects
  for insert with check (bucket_id = 'event-images' and is_admin());
create policy "event_images_admin_delete" on storage.objects
  for delete using (bucket_id = 'event-images' and is_admin());
