-- ============================================================
-- 224 Clubhouse — product reviews (2026-10-05)
-- ============================================================
-- * Only a customer with a DELIVERED order containing the product can review
--   it, once (editing replaces the review and sends it back for approval).
-- * Every review is hidden until an admin approves it (/admin/reviews) —
--   moderation keeps out health/medical claims and personal details.
-- * The public never reads the table: get_product_reviews returns only the
--   display name, rating, text and date of APPROVED reviews. No user ids,
--   emails or order details leave the database.
-- ============================================================

create table if not exists product_reviews (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references products(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  rating        smallint not null check (rating between 1 and 5),
  body          text not null default '' check (length(body) <= 1000),
  display_name  text not null check (length(trim(display_name)) between 1 and 40),
  status        text not null default 'pending'
                check (status in ('pending', 'approved', 'rejected')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  moderated_at  timestamptz,
  unique (product_id, user_id)
);

-- Public listing (approved, newest first) and the admin queue.
create index if not exists product_reviews_product_status_idx
  on product_reviews (product_id, status, created_at desc);
create index if not exists product_reviews_status_idx
  on product_reviews (status, created_at desc);
create index if not exists product_reviews_user_id_idx
  on product_reviews (user_id);

alter table product_reviews enable row level security;

-- Owners see their own review (any status); admins see and moderate all.
-- Inserts and owner edits go through submit_product_review only.
drop policy if exists "product_reviews_owner_select" on product_reviews;
create policy "product_reviews_owner_select" on product_reviews
  for select using ((select auth.uid()) = user_id);
drop policy if exists "product_reviews_admin_select" on product_reviews;
create policy "product_reviews_admin_select" on product_reviews
  for select using (is_admin());
drop policy if exists "product_reviews_admin_update" on product_reviews;
create policy "product_reviews_admin_update" on product_reviews
  for update using (is_admin()) with check (is_admin());
drop policy if exists "product_reviews_admin_delete" on product_reviews;
create policy "product_reviews_admin_delete" on product_reviews
  for delete using (is_admin());

-- True when this account has a delivered order that includes the product.
-- orders.items stores product ids as JSON strings (place_cod_order).
create or replace function has_delivered_purchase(p_uid uuid, p_product_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from orders o
     where o.user_id = p_uid
       and o.status = 'delivered'
       and o.items @> jsonb_build_array(jsonb_build_object('id', p_product_id::text))
  );
$$;

revoke execute on function has_delivered_purchase(uuid, uuid) from public, anon, authenticated;

-- What the product page needs to decide whether to show the review form.
create or replace function my_review_status(p_product_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_rev product_reviews%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('eligible', false, 'review', null);
  end if;
  select * into v_rev from product_reviews where product_id = p_product_id and user_id = v_uid;
  return jsonb_build_object(
    'eligible', has_delivered_purchase(v_uid, p_product_id),
    'review', case when found then jsonb_build_object(
      'rating', v_rev.rating, 'body', v_rev.body,
      'display_name', v_rev.display_name, 'status', v_rev.status) end
  );
end;
$$;

revoke execute on function my_review_status(uuid) from public, anon;
grant  execute on function my_review_status(uuid) to authenticated;

create or replace function submit_product_review(
  p_product_id   uuid,
  p_rating       int,
  p_body         text,
  p_display_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_body text := trim(coalesce(p_body, ''));
  v_name text := trim(coalesce(p_display_name, ''));
begin
  if v_uid is null then raise exception 'Sign in required to leave a review'; end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be between 1 and 5';
  end if;
  if length(v_body) > 1000 then raise exception 'Review is too long (1000 characters max)'; end if;
  if length(v_name) < 1 or length(v_name) > 40 then
    raise exception 'Please give a display name (up to 40 characters)';
  end if;
  if not has_delivered_purchase(v_uid, p_product_id) then
    raise exception 'Only customers who have received this product can review it';
  end if;

  insert into product_reviews (product_id, user_id, rating, body, display_name)
  values (p_product_id, v_uid, p_rating, v_body, v_name)
  on conflict (product_id, user_id) do update
     set rating = excluded.rating,
         body = excluded.body,
         display_name = excluded.display_name,
         -- An edited review is re-moderated.
         status = 'pending',
         updated_at = now(),
         moderated_at = null;

  return jsonb_build_object('status', 'pending');
end;
$$;

revoke execute on function submit_product_review(uuid, int, text, text) from public, anon;
grant  execute on function submit_product_review(uuid, int, text, text) to authenticated;

-- Public: approved reviews only, and only the fields shown on the page.
create or replace function get_product_reviews(p_product_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'count',   (select count(*) from product_reviews
                 where product_id = p_product_id and status = 'approved'),
    'average', (select round(avg(rating)::numeric, 1) from product_reviews
                 where product_id = p_product_id and status = 'approved'),
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object(
               'display_name', r.display_name, 'rating', r.rating,
               'body', r.body, 'created_at', r.created_at)
             order by r.created_at desc)
        from (select * from product_reviews
               where product_id = p_product_id and status = 'approved'
               order by created_at desc
               limit 50) r
    ), '[]'::jsonb)
  );
$$;

grant execute on function get_product_reviews(uuid) to anon, authenticated;

-- Admin moderation stamps the time; a plain RLS update would leave it null.
create or replace function product_reviews_moderated()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    new.moderated_at := case when new.status = 'pending' then null else now() end;
  end if;
  return new;
end;
$$;

drop trigger if exists product_reviews_moderated on product_reviews;
create trigger product_reviews_moderated
  before update on product_reviews
  for each row execute function product_reviews_moderated();
