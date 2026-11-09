-- ============================================================
-- Store-scoped product and event images (2026-11-09)
-- ============================================================
-- Before this, any store's admin could upload to and DELETE from the whole
-- product-images / event-images buckets: is_admin() only proves the caller is
-- an admin of their own store, and object paths were not checked (OPEN_ITEMS.md
-- "must fix before a second store has an admin"). Explosive 420 has admins.
--
-- Paths today (src/utils/uploadPath.js):
--   * a store with tenant.json images.uploadFolder uploads under it:
--     e420/products/<file>, e420/events/<file>;
--   * 224 has none: products/<file>, events/<file>, plus older seeded files at
--     the bucket root.
-- So:
--   * tenants.upload_folder records each store's folder (null for 224);
--   * a store WITH a folder may only write and delete inside it;
--   * a store WITHOUT one (224) may write and delete anywhere EXCEPT another
--     store's folder. 224's existing paths keep working unchanged.
-- Public read is unchanged. There is no update policy on these buckets, so
-- object updates (upsert) stay refused for every admin, as before.
--
-- A new store sets upload_folder when it is provisioned (equal to its
-- tenant.json images.uploadFolder); until then it falls in the "no folder"
-- branch, which still cannot touch a store that has one.
-- ============================================================

alter table public.tenants add column if not exists upload_folder text;

alter table public.tenants drop constraint if exists tenants_upload_folder_check;
alter table public.tenants add constraint tenants_upload_folder_check
  check (upload_folder is null or upload_folder ~ '^[a-z0-9-]{2,40}$');

create unique index if not exists tenants_upload_folder_key
  on public.tenants (upload_folder) where upload_folder is not null;

-- Explosive 420's folder (tenants/explosive420/tenant.json images.uploadFolder).
-- No row on a fresh local stack: then this changes nothing.
update public.tenants set upload_folder = 'e420'
 where slug = 'explosive420' and upload_folder is null;

-- True when the object path belongs to the caller's store (current_tenant()).
-- Unknown store → null → the policy refuses.
create or replace function public.image_path_in_my_store(p_name text)
returns boolean
language sql
stable
set search_path = public
as $$
  select case
    when t.upload_folder is not null then
      starts_with(coalesce(p_name, ''), t.upload_folder || '/')
    else not exists (
      select 1 from public.tenants o
       where o.upload_folder is not null
         and starts_with(coalesce(p_name, ''), o.upload_folder || '/')
    )
  end
  from public.tenants t
  where t.slug = public.current_tenant()
$$;

revoke execute on function public.image_path_in_my_store(text) from public;
grant execute on function public.image_path_in_my_store(text) to anon, authenticated;

drop policy if exists "product_images_admin_upload" on storage.objects;
create policy "product_images_admin_upload" on storage.objects
  for insert with check (bucket_id = 'product-images' and public.is_admin() and public.image_path_in_my_store(name));

drop policy if exists "product_images_admin_delete" on storage.objects;
create policy "product_images_admin_delete" on storage.objects
  for delete using (bucket_id = 'product-images' and public.is_admin() and public.image_path_in_my_store(name));

drop policy if exists "event_images_admin_upload" on storage.objects;
create policy "event_images_admin_upload" on storage.objects
  for insert with check (bucket_id = 'event-images' and public.is_admin() and public.image_path_in_my_store(name));

drop policy if exists "event_images_admin_delete" on storage.objects;
create policy "event_images_admin_delete" on storage.objects
  for delete using (bucket_id = 'event-images' and public.is_admin() and public.image_path_in_my_store(name));
