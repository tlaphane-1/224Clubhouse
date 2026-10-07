-- ============================================================
-- 224 Clubhouse — EFT payment verification (2026-10-07)
-- ============================================================
-- EFT orders used to have no payment state at all: nothing recorded whether
-- the money arrived, and nothing stopped an unpaid EFT order being dispatched.
--
-- 1. orders gains payment columns: paid_at / paid_amount_cents /
--    payment_confirmed_by (set by an admin after checking the FNB app) and
--    payment_proof_path / payment_proof_uploaded_at (the customer's proof of
--    payment, optional).
-- 2. Private storage bucket `payment-proofs`. A customer may upload only into
--    <their uid>/<their EFT order id>/…; they and admins may read; nobody else.
--    A proof is a CLAIM, not evidence — POPs are easy to fake, so an admin
--    still confirms against the bank before marking the order paid.
-- 3. attach_payment_proof: records an uploaded proof on the customer's order.
-- 4. admin_set_eft_payment: admin marks payment received (or undoes it).
-- 5. admin_update_order_status: an EFT order cannot move to preparing /
--    out_for_delivery / delivered until its payment is confirmed.
-- 6. get_order_tracking also returns paid_at, so /track stops showing the
--    bank details once an order is paid.
-- ============================================================

alter table orders add column if not exists paid_at timestamptz;
alter table orders add column if not exists paid_amount_cents integer
  check (paid_amount_cents is null or paid_amount_cents >= 0);
alter table orders add column if not exists payment_confirmed_by uuid
  references auth.users(id) on delete set null;
alter table orders add column if not exists payment_proof_path text;
alter table orders add column if not exists payment_proof_uploaded_at timestamptz;

-- The admin "EFT to check" view filters on these.
create index if not exists orders_eft_unpaid_idx
  on orders (created_at desc)
  where payment_method = 'eft' and paid_at is null;

-- ---- Storage ----------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-proofs', 'payment-proofs', false, 5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Path layout: <uid>/<order id>/<file>. Compared as text so a malformed path
-- is simply "no match", never a uuid cast error.
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
    )
  );

drop policy if exists "payment_proofs_owner_select" on storage.objects;
create policy "payment_proofs_owner_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'payment-proofs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "payment_proofs_admin_select" on storage.objects;
create policy "payment_proofs_admin_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'payment-proofs' and public.is_admin());

drop policy if exists "payment_proofs_admin_delete" on storage.objects;
create policy "payment_proofs_admin_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'payment-proofs' and public.is_admin());

-- ---- Customer: attach an uploaded proof to their order -----------------
create or replace function attach_payment_proof(p_order_id uuid, p_path text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row orders%rowtype;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;

  select * into v_row from orders where id = p_order_id for update;
  if not found or v_row.user_id is distinct from v_uid then
    raise exception 'Order not found';
  end if;
  if v_row.payment_method <> 'eft' then raise exception 'This order is not paid by EFT'; end if;
  if v_row.status = 'cancelled' then raise exception 'This order has been cancelled'; end if;
  if v_row.paid_at is not null then raise exception 'Payment for this order is already confirmed'; end if;

  -- The path must be inside this customer's folder for this order, and the
  -- file must really be in the bucket (uploaded under the storage policy).
  if p_path is null or p_path not like (v_uid::text || '/' || p_order_id::text || '/%') then
    raise exception 'Invalid proof of payment path';
  end if;
  if not exists (
    select 1 from storage.objects
     where bucket_id = 'payment-proofs' and name = p_path
  ) then
    raise exception 'Proof of payment file not found';
  end if;

  update orders
     set payment_proof_path = p_path,
         payment_proof_uploaded_at = now()
   where id = p_order_id;

  return jsonb_build_object('payment_proof_uploaded_at', now());
end;
$$;

revoke execute on function attach_payment_proof(uuid, text) from public, anon;
grant  execute on function attach_payment_proof(uuid, text) to authenticated;

-- ---- Admin: mark an EFT payment received (or undo) ----------------------
create or replace function admin_set_eft_payment(
  p_order_id     uuid,
  p_received     boolean,
  p_amount_cents integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row orders%rowtype;
  v_amount int;
begin
  if not is_admin() then raise exception 'Not authorized'; end if;

  select * into v_row from orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_row.payment_method <> 'eft' then raise exception 'This order is not paid by EFT'; end if;

  if p_received then
    if v_row.status = 'cancelled' then raise exception 'This order has been cancelled'; end if;
    v_amount := coalesce(p_amount_cents, v_row.total);
    if v_amount < 0 then raise exception 'Amount cannot be negative'; end if;
    update orders
       set paid_at = now(),
           paid_amount_cents = v_amount,
           payment_confirmed_by = auth.uid()
     where id = p_order_id
     returning * into v_row;
  else
    -- Undo a mistaken confirmation. Not allowed once the goods have moved on
    -- the strength of it.
    if v_row.status in ('preparing', 'out_for_delivery', 'delivered') then
      raise exception 'Move the order back to Confirmed before undoing its payment';
    end if;
    update orders
       set paid_at = null, paid_amount_cents = null, payment_confirmed_by = null
     where id = p_order_id
     returning * into v_row;
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'paid_at', v_row.paid_at,
    'paid_amount_cents', v_row.paid_amount_cents,
    'short', case when v_row.paid_amount_cents is not null
                  then v_row.paid_amount_cents < v_row.total else false end
  );
end;
$$;

revoke execute on function admin_set_eft_payment(uuid, boolean, integer) from public, anon;
grant  execute on function admin_set_eft_payment(uuid, boolean, integer) to authenticated;

-- ---- get_order_tracking: + paid_at ---------------------------------------
-- Body is 20260814110000 verbatim plus the one field.
create or replace function get_order_tracking(p_order_number text, p_email text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'order_number',        o.order_number,
    'status',              o.status,
    'status_history',      o.status_history,
    'payment_method',      o.payment_method,
    'subtotal',            o.subtotal,
    'shipping_fee',        o.shipping_fee,
    'discount_code',       o.discount_code,
    'discount_cents',      coalesce(o.discount_cents, 0),
    'total',               o.total,
    'items',               o.items,
    'created_at',          o.created_at,
    'customer_first_name', split_part(o.customer_name, ' ', 1),
    'city',                o.shipping_address->>'city',
    'paid_at',             o.paid_at
  )
  from orders o
  where o.order_number = upper(trim(p_order_number))
    and lower(o.customer_email) = lower(trim(p_email))
  limit 1;
$$;

grant execute on function get_order_tracking(text, text) to anon, authenticated;

-- ---- admin_update_order_status: EFT payment gate -----------------------
-- Body is 20261005140000 verbatim plus the EFT PAYMENT GATE block.
create or replace function admin_update_order_status(p_order_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row      orders%rowtype;
  v_line     record;
  v_units    int := 0;   -- units returned to stock
  v_lines    int := 0;   -- distinct product/option lines credited
  v_missing  int := 0;   -- lines whose product no longer exists
  v_note     text;
  v_entry    jsonb;
begin
  if not is_admin() then raise exception 'Not authorized'; end if;
  if p_status not in ('pending','confirmed','preparing','out_for_delivery',
                      'paid','processing','shipped','delivered','cancelled') then
    raise exception 'Invalid status';
  end if;

  -- Lock the order FIRST: the current-status read, the restock and the status
  -- write all happen under this lock, which is what makes a double-cancel a
  -- no-op instead of a double credit (design note 2).
  select * into v_row from orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;

  -- EFT PAYMENT GATE (20261007120000): an unpaid EFT order can be confirmed
  -- or cancelled, but not prepared, sent out or delivered.
  if v_row.payment_method = 'eft' and v_row.paid_at is null
     and p_status in ('preparing', 'out_for_delivery', 'delivered') then
    raise exception 'EFT payment not confirmed yet: mark the payment received first';
  end if;

  if p_status = 'cancelled' and v_row.status is distinct from 'cancelled' then
    if v_row.status = 'delivered' then
      -- Design note 1: the goods left the building. Say so instead of
      -- inventing stock.
      v_note := 'stock NOT restored — order was already marked delivered; '
                || 'adjust product stock by hand if the goods came back';
    else
      -- Aggregate per product (a cart can list the same product twice) and
      -- walk them in id order so concurrent cancels lock in the same
      -- sequence. The regex filter keeps a malformed legacy line from
      -- aborting the cancellation on a uuid cast.
      for v_line in
        select (elem->>'id')::uuid as product_id,
               case when elem->>'variant_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                    then (elem->>'variant_id')::uuid end as variant_id,
               sum(greatest(0, coalesce((elem->>'quantity')::int, 0)))::int as qty
          from jsonb_array_elements(
                 case when jsonb_typeof(v_row.items) = 'array'
                      then v_row.items else '[]'::jsonb end
               ) as elem
         where elem->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         group by 1, 2
         order by 1, 2
      loop
        if v_line.qty <= 0 then
          continue;
        end if;
        -- Lock the product row so the credit can't race place_cod_order's
        -- guarded decrement of the same row.
        perform 1 from products where id = v_line.product_id for update;
        if not found then
          v_missing := v_missing + 1;   -- design note 4: skip, don't fail
          continue;
        end if;
        if v_line.variant_id is not null then
          -- Credit the option that was sold; the sync trigger recomputes the
          -- product total. A deleted option is skipped like a deleted product:
          -- crediting the product directly would be overwritten by the next sync.
          update product_variants
             set stock_quantity = stock_quantity + v_line.qty
           where id = v_line.variant_id and product_id = v_line.product_id;
          if not found then
            v_missing := v_missing + 1;
            continue;
          end if;
        else
          update products
             set stock_quantity = stock_quantity + v_line.qty
           where id = v_line.product_id;
        end if;
        v_units := v_units + v_line.qty;
        v_lines := v_lines + 1;
      end loop;

      v_note := 'stock restored: ' || v_units || ' unit(s) across '
                || v_lines || ' product(s)';
      if v_missing > 0 then
        v_note := v_note || '; ' || v_missing
                  || ' line(s) skipped — product or option no longer exists';
      end if;
    end if;
  end if;

  -- Same history idiom as admin_update_membership_status: {status, at, actor},
  -- plus a `note` on the entries where stock moved (or deliberately didn't).
  v_entry := jsonb_build_object('status', p_status, 'at', now(), 'actor', auth.uid());
  if v_note is not null then
    v_entry := v_entry || jsonb_build_object('note', v_note);
  end if;

  update orders
     set status         = p_status,
         status_history = coalesce(status_history, '[]'::jsonb) || v_entry
   where id = p_order_id
   returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id, 'status', v_row.status, 'restocked_units', v_units
  );
end;
$$;

-- create-or-replace preserves the old grants, and EXECUTE defaults to PUBLIC —
-- revoke both explicitly, then grant only to signed-in users. The is_admin()
-- check inside the function stays as the real boundary (repo idiom).
revoke execute on function admin_update_order_status(uuid, text) from public, anon;
grant  execute on function admin_update_order_status(uuid, text) to authenticated;

-- ---- Capability probe ------------------------------------------------
create or replace function eft_verification_applied()
returns boolean
language sql
immutable
set search_path = public
as $$ select true $$;

grant execute on function eft_verification_applied() to anon, authenticated;
