-- ============================================================
-- 224 Clubhouse — Cancelling an order returns its stock
-- ============================================================
-- BUG (inventory leak): place_cod_order DECREMENTS products.stock_quantity
-- when an order is created, but admin_update_order_status only ever wrote
-- `status` + `status_history`. Cancelling therefore destroyed those units
-- permanently — every cancellation silently shrank sellable inventory, with
-- nothing in the UI to hint at it. The only recovery was an admin noticing
-- and hand-editing the product's stock.
--
-- (Legacy orders count too: the pre-COD client-side checkout also decremented,
-- via the decrement_stock RPC — see 8c6a242 src/pages/Checkout.jsx step 2 — so
-- units are genuinely "out" for every non-cancelled order in the table,
-- whatever created it. No cutoff date is needed.)
--
-- This migration re-creates admin_update_order_status with the 20260622130000
-- body VERBATIM plus a restock step. Everything else about the function is
-- unchanged: is_admin() gating, SECURITY DEFINER, pinned search_path, same
-- signature, same status vocabulary.
--
-- DESIGN NOTES
--
-- 1. delivered -> cancelled does NOT restock. The two failure modes are not
--    symmetrical:
--      - Restocking goods that physically left the building creates PHANTOM
--        stock. The shop then oversells: a customer buys a unit that does not
--        exist, and the failure surfaces at the door, after money and a
--        delivery slot have been committed.
--      - Not restocking a mis-clicked 'delivered' understates stock. The shop
--        under-sells by a few units until someone corrects the number in
--        admin > Products — a lost sale, never a broken promise.
--    Inventory accuracy is best served by refusing to invent units the system
--    cannot see. A physical return is a separate, deliberate event (the goods
--    have to come back and be inspected), not something a status dropdown can
--    infer. So the cancellation still goes through, and the history entry says
--    in words that stock was NOT restored and must be adjusted by hand if the
--    goods came back — visible in the same place the admin looks anyway.
--    Every other status (pending / confirmed / preparing / out_for_delivery
--    and the legacy paid / processing / shipped) restocks: those goods are
--    either still on the shelf or still with the driver.
--
-- 2. Idempotency is enforced by the ORDER row lock, not by a flag. The row is
--    taken `for update` before its status is read, and the read, the restock
--    and the write all happen under that one lock inside a single function
--    call (= one transaction). A second, concurrent "cancel" blocks on the
--    lock, then — READ COMMITTED re-reads the row after acquiring it — sees
--    status already 'cancelled' and restocks nothing. Cancelling an
--    already-cancelled order is a plain no-op status write.
--
-- 3. Product rows are locked one at a time in ascending id order, so two
--    concurrent cancellations touching overlapping carts can never deadlock
--    against each other. (place_cod_order locks products in cart order, which
--    is not sorted; that is its migration to fix, not this one's. It also
--    never locks an existing orders row, so the orders-then-products lock
--    order taken here cannot deadlock against it.)
--
-- 4. A missing product is skipped, not fatal: an order can outlive the product
--    it contains, and the cancellation is the important part. The count of
--    skipped lines goes into the history note so the admin can see it.
--
-- KNOWN LIMITATION (deliberate, out of scope here): the inverse move,
-- cancelled -> pending ("un-cancel"), does NOT re-decrement. Stock would then
-- be overstated by that order. Un-cancelling is not a flow the admin UI
-- encourages and re-decrementing can fail (the units may since have sold),
-- which would block the status change itself. Left for a follow-up.
-- ============================================================

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
  v_lines    int := 0;   -- distinct products credited
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
               sum(greatest(0, coalesce((elem->>'quantity')::int, 0)))::int as qty
          from jsonb_array_elements(
                 case when jsonb_typeof(v_row.items) = 'array'
                      then v_row.items else '[]'::jsonb end
               ) as elem
         where elem->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         group by 1
         order by 1
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
        update products
           set stock_quantity = stock_quantity + v_line.qty
         where id = v_line.product_id;
        v_units := v_units + v_line.qty;
        v_lines := v_lines + 1;
      end loop;

      v_note := 'stock restored: ' || v_units || ' unit(s) across '
                || v_lines || ' product(s)';
      if v_missing > 0 then
        v_note := v_note || '; ' || v_missing
                  || ' line(s) skipped — product no longer exists';
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

-- ---- Capability probe -------------------------------------------------
-- The fix lives inside an EXISTING function signature, so there is no new
-- name for a client to detect and nothing readable through PostgREST (pg_proc
-- is not exposed). This one-line function is the detectable marker: the
-- restock contract test probes it and skips cleanly until this migration is
-- pushed, instead of failing against the old behaviour. Read-only, exposes
-- no data.
create or replace function order_cancel_restocks()
returns boolean
language sql
immutable
set search_path = public
as $$ select true $$;

grant execute on function order_cancel_restocks() to anon, authenticated;
