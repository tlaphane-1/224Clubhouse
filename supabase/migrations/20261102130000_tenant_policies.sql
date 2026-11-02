-- Multi-tenant phase 2, task 5: tenant-aware is_admin()/is_driver() and the
-- tenant predicate on every RLS policy of the 19 tenant tables, plus the four
-- payment-proofs storage policies.
--
-- After this file each store sees only its own rows through RLS. 224 keeps
-- working on its own: every existing row is '224clubhouse' (task 4 backfill),
-- and current_tenant() is '224clubhouse' for every existing caller (anon with
-- no header, and signed-in users with no tenant claim — task 3).
--
-- Each policy keeps its name, command, roles and original condition (taken
-- from pg_policies on a stack with all earlier migrations applied); only
-- `tenant = (select public.current_tenant())` is ANDed on. The select wrapper
-- makes Postgres evaluate it once per statement (initPlan), not once per row.
-- Policies that write carry the predicate in WITH CHECK as well, so a row can
-- neither be written into nor moved to another store.
--
-- Tables with RLS on but no policies (site_events, customer_email_prefs,
-- driver_locations, alert_settings) stay closed: there is nothing to scope.
-- The tenants table is not a tenant table; tenants_public_select is untouched.
-- The product-images / event-images admin storage policies need no change:
-- they call is_admin(), which is now tenant-scoped.

-- ---- 1. is_admin() / is_driver() ---------------------------------------------
-- Body only (create or replace keeps the signature, owner, and the existing
-- EXECUTE grants). Still SECURITY DEFINER, so the admin_users / drivers reads
-- are not subject to RLS and need no (select ...) wrapper.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from admin_users
     where id = auth.uid()
       and tenant = public.current_tenant()
  );
$$;

create or replace function public.is_driver()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from drivers
     where user_id = auth.uid()
       and active
       and tenant = public.current_tenant()
  );
$$;

-- ---- 2. products --------------------------------------------------------------
drop policy if exists products_public_select on products;
create policy products_public_select on products for select
  using (tenant = (select public.current_tenant()));

drop policy if exists products_admin_insert on products;
create policy products_admin_insert on products for insert
  with check (is_admin() and tenant = (select public.current_tenant()));

drop policy if exists products_admin_update on products;
create policy products_admin_update on products for update
  using (is_admin() and tenant = (select public.current_tenant()))
  with check (is_admin() and tenant = (select public.current_tenant()));

drop policy if exists products_admin_delete on products;
create policy products_admin_delete on products for delete
  using (is_admin() and tenant = (select public.current_tenant()));

-- ---- 3. product_variants ------------------------------------------------------
drop policy if exists product_variants_public_select on product_variants;
create policy product_variants_public_select on product_variants for select
  using (tenant = (select public.current_tenant()));

drop policy if exists product_variants_admin_insert on product_variants;
create policy product_variants_admin_insert on product_variants for insert
  with check (is_admin() and tenant = (select public.current_tenant()));

drop policy if exists product_variants_admin_update on product_variants;
create policy product_variants_admin_update on product_variants for update
  using (is_admin() and tenant = (select public.current_tenant()))
  with check (is_admin() and tenant = (select public.current_tenant()));

drop policy if exists product_variants_admin_delete on product_variants;
create policy product_variants_admin_delete on product_variants for delete
  using (is_admin() and tenant = (select public.current_tenant()));

-- ---- 4. product_reviews -------------------------------------------------------
drop policy if exists product_reviews_owner_select on product_reviews;
create policy product_reviews_owner_select on product_reviews for select
  using ((select auth.uid()) = user_id and tenant = (select public.current_tenant()));

drop policy if exists product_reviews_admin_select on product_reviews;
create policy product_reviews_admin_select on product_reviews for select
  using (is_admin() and tenant = (select public.current_tenant()));

drop policy if exists product_reviews_admin_update on product_reviews;
create policy product_reviews_admin_update on product_reviews for update
  using (is_admin() and tenant = (select public.current_tenant()))
  with check (is_admin() and tenant = (select public.current_tenant()));

drop policy if exists product_reviews_admin_delete on product_reviews;
create policy product_reviews_admin_delete on product_reviews for delete
  using (is_admin() and tenant = (select public.current_tenant()));

-- ---- 5. events ----------------------------------------------------------------
drop policy if exists events_public_select on events;
create policy events_public_select on events for select
  using (tenant = (select public.current_tenant()));

drop policy if exists events_admin_insert on events;
create policy events_admin_insert on events for insert
  with check (is_admin() and tenant = (select public.current_tenant()));

drop policy if exists events_admin_update on events;
create policy events_admin_update on events for update
  using (is_admin() and tenant = (select public.current_tenant()))
  with check (is_admin() and tenant = (select public.current_tenant()));

drop policy if exists events_admin_delete on events;
create policy events_admin_delete on events for delete
  using (is_admin() and tenant = (select public.current_tenant()));

-- ---- 6. event_reservations ----------------------------------------------------
drop policy if exists event_reservations_owner_select on event_reservations;
create policy event_reservations_owner_select on event_reservations for select
  to authenticated
  using (user_id = auth.uid() and tenant = (select public.current_tenant()));

drop policy if exists event_reservations_admin_all on event_reservations;
create policy event_reservations_admin_all on event_reservations for all
  using (is_admin() and tenant = (select public.current_tenant()))
  with check (is_admin() and tenant = (select public.current_tenant()));

-- ---- 7. membership_tiers ------------------------------------------------------
drop policy if exists membership_tiers_public_select on membership_tiers;
create policy membership_tiers_public_select on membership_tiers for select
  using (is_active and tenant = (select public.current_tenant()));

drop policy if exists membership_tiers_admin_all on membership_tiers;
create policy membership_tiers_admin_all on membership_tiers for all
  using (is_admin() and tenant = (select public.current_tenant()))
  with check (is_admin() and tenant = (select public.current_tenant()));

-- ---- 8. memberships -----------------------------------------------------------
drop policy if exists memberships_admin_select on memberships;
create policy memberships_admin_select on memberships for select
  using (is_admin() and tenant = (select public.current_tenant()));

drop policy if exists memberships_admin_update on memberships;
create policy memberships_admin_update on memberships for update
  using (is_admin() and tenant = (select public.current_tenant()))
  with check (is_admin() and tenant = (select public.current_tenant()));

drop policy if exists memberships_admin_delete on memberships;
create policy memberships_admin_delete on memberships for delete
  using (is_admin() and tenant = (select public.current_tenant()));

drop policy if exists memberships_owner_select on memberships;
create policy memberships_owner_select on memberships for select
  to authenticated
  using (user_id = auth.uid() and tenant = (select public.current_tenant()));

-- ---- 9. orders ----------------------------------------------------------------
drop policy if exists orders_admin_select on orders;
create policy orders_admin_select on orders for select
  using (is_admin() and tenant = (select public.current_tenant()));

drop policy if exists orders_admin_update on orders;
create policy orders_admin_update on orders for update
  using (is_admin() and tenant = (select public.current_tenant()))
  with check (is_admin() and tenant = (select public.current_tenant()));

drop policy if exists orders_admin_delete on orders;
create policy orders_admin_delete on orders for delete
  using (is_admin() and tenant = (select public.current_tenant()));

drop policy if exists orders_owner_select on orders;
create policy orders_owner_select on orders for select
  to authenticated
  using (user_id = auth.uid() and tenant = (select public.current_tenant()));

drop policy if exists orders_driver_select on orders;
create policy orders_driver_select on orders for select
  using (driver_id = (select auth.uid()) and is_driver()
         and tenant = (select public.current_tenant()));

-- ---- 10. discount_codes -------------------------------------------------------
drop policy if exists discount_codes_admin_all on discount_codes;
create policy discount_codes_admin_all on discount_codes for all
  using (is_admin() and tenant = (select public.current_tenant()))
  with check (is_admin() and tenant = (select public.current_tenant()));

-- ---- 11. newsletter_subscribers -----------------------------------------------
-- Was `with check (true)`: an anonymous insert may now only land in the
-- caller's own store. A row inserted without a tenant takes the column default
-- (current_tenant()), so the unchanged 224 form still passes.
drop policy if exists newsletter_public_insert on newsletter_subscribers;
create policy newsletter_public_insert on newsletter_subscribers for insert
  with check (tenant = (select public.current_tenant()));

drop policy if exists newsletter_admin_select on newsletter_subscribers;
create policy newsletter_admin_select on newsletter_subscribers for select
  using (is_admin() and tenant = (select public.current_tenant()));

-- ---- 12. contact_messages -----------------------------------------------------
drop policy if exists contact_public_insert on contact_messages;
create policy contact_public_insert on contact_messages for insert
  with check (tenant = (select public.current_tenant()));

drop policy if exists contact_admin_select on contact_messages;
create policy contact_admin_select on contact_messages for select
  using (is_admin() and tenant = (select public.current_tenant()));

-- ---- 13. saved_carts ----------------------------------------------------------
drop policy if exists saved_carts_owner_select on saved_carts;
create policy saved_carts_owner_select on saved_carts for select
  using ((select auth.uid()) = user_id and tenant = (select public.current_tenant()));

drop policy if exists saved_carts_owner_insert on saved_carts;
create policy saved_carts_owner_insert on saved_carts for insert
  with check ((select auth.uid()) = user_id and tenant = (select public.current_tenant()));

drop policy if exists saved_carts_owner_update on saved_carts;
create policy saved_carts_owner_update on saved_carts for update
  using ((select auth.uid()) = user_id and tenant = (select public.current_tenant()))
  with check ((select auth.uid()) = user_id and tenant = (select public.current_tenant()));

drop policy if exists saved_carts_owner_delete on saved_carts;
create policy saved_carts_owner_delete on saved_carts for delete
  using ((select auth.uid()) = user_id and tenant = (select public.current_tenant()));

-- ---- 14. customer_profiles ----------------------------------------------------
drop policy if exists customer_profiles_owner_select on customer_profiles;
create policy customer_profiles_owner_select on customer_profiles for select
  using ((select auth.uid()) = user_id and tenant = (select public.current_tenant()));

-- ---- 15. drivers --------------------------------------------------------------
drop policy if exists drivers_admin_all on drivers;
create policy drivers_admin_all on drivers for all
  using (is_admin() and tenant = (select public.current_tenant()))
  with check (is_admin() and tenant = (select public.current_tenant()));

drop policy if exists drivers_self_select on drivers;
create policy drivers_self_select on drivers for select
  using ((select auth.uid()) = user_id and tenant = (select public.current_tenant()));

-- ---- 16. admin_users ----------------------------------------------------------
drop policy if exists admin_users_self_select on admin_users;
create policy admin_users_self_select on admin_users for select
  using (id = auth.uid() and tenant = (select public.current_tenant()));

-- ---- 17. storage: payment-proofs ----------------------------------------------
-- Object paths are not store-prefixed (<uid>/<order id>/<file>), so the store
-- is read from the order the path names: (storage.foldername(name))[2]. The
-- comparison stays text so a malformed path is "no match", never a cast error.
-- The orders subquery runs under the caller's own orders RLS, which is itself
-- tenant-scoped; the explicit o.tenant test keeps these policies correct on
-- their own.
drop policy if exists "payment_proofs_owner_insert" on storage.objects;
create policy "payment_proofs_owner_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'payment-proofs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.orders o
       where o.id::text = (storage.foldername(name))[2]
         and o.user_id = (select auth.uid())
         and o.payment_method = 'eft'
         and o.status <> 'cancelled'
         and o.paid_at is null
         and o.tenant = (select public.current_tenant())
    )
  );

drop policy if exists "payment_proofs_owner_select" on storage.objects;
create policy "payment_proofs_owner_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'payment-proofs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.orders o
       where o.id::text = (storage.foldername(name))[2]
         and o.tenant = (select public.current_tenant())
    )
  );

drop policy if exists "payment_proofs_admin_select" on storage.objects;
create policy "payment_proofs_admin_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'payment-proofs'
    and public.is_admin()
    and exists (
      select 1 from public.orders o
       where o.id::text = (storage.foldername(name))[2]
         and o.tenant = (select public.current_tenant())
    )
  );

drop policy if exists "payment_proofs_admin_delete" on storage.objects;
create policy "payment_proofs_admin_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'payment-proofs'
    and public.is_admin()
    and exists (
      select 1 from public.orders o
       where o.id::text = (storage.foldername(name))[2]
         and o.tenant = (select public.current_tenant())
    )
  );
