-- ============================================================
-- 224 Clubhouse — Follow-up fixes for the 2026-08-14 batch
-- ============================================================
-- Three MEDIUM findings from the code review of 20260814100000 (newsletter
-- unsubscribe) and 20260814103000 (discount codes). Those four migrations are
-- ALREADY APPLIED, so nothing here edits them — every fix is expressed as a
-- forward change that is safe to re-run.
--
--   FIX 1  newsletter_subscribers.email is not normalised on disk, so the new
--          subscribe_newsletter() (which stores lower(trim(email))) misses
--          legacy mixed-case rows on its `on conflict (email)` and creates a
--          SECOND row. Two rows = two mails = two tokens, and unsubscribing
--          one leaves the other on the list. Backfill + a normalising trigger.
--
--   FIX 2  first_order_only ("WELCOME10") is checked with no lock, so two
--          concurrent checkouts for the same account can both see zero prior
--          orders and both redeem it. Serialise per account with a
--          transaction-scoped advisory lock.
--
--   FIX 3  get_order_tracking() predates orders.discount_code/discount_cents,
--          so /track shows a Subtotal + Shipping that does not add up to the
--          Total on any discounted order. Add the two fields to its jsonb.
--
-- Idempotent DDL throughout (create or replace / if not exists / if exists),
-- pinned search_path on every definer function, explicit grants at the end of
-- each section — same idioms as the migrations it follows.
-- ============================================================


-- ---------------------------------------------------------------------------
-- ACCEPTED BEHAVIOUR — review finding 7, recorded here rather than "fixed"
-- ---------------------------------------------------------------------------
-- Cancelling an order makes a first_order_only code usable AGAIN (discount_eval
-- excludes cancelled orders from its "has this account ordered before?" test),
-- while discount_codes.times_redeemed is never decremented when an order is
-- cancelled. Both halves of that are deliberate for now:
--
--   * A cancelled order should NOT consume someone's welcome discount. The
--     customer never received goods; burning their one-time code because a
--     shop-side cancellation happened would be a support ticket every time,
--     and the abuse ceiling is one 10% discount per account per cancellation
--     the SHOP has to action (admin_update_order_status is is_admin()-gated —
--     customers cannot cancel their own orders).
--   * times_redeemed is a campaign-cost counter, not an entitlement ledger.
--     Decrementing it on cancel would need a real reconciliation path — a
--     redemption record per order, so a refund can be matched to the exact
--     redemption it reverses and a double-cancel cannot credit twice. That is
--     a table and a migration of its own, not a `- 1` in the status RPC.
--
-- Net effect while this stands: on a capped code, a cancelled order still
-- consumes one of max_redemptions. Under-issuing a capped campaign is the
-- cheap failure; the expensive one (a customer losing their welcome discount
-- to a cancellation they did not ask for) is the one avoided.
-- ---------------------------------------------------------------------------


-- ============================================================
-- FIX 1 — newsletter_subscribers.email normalisation
-- ============================================================
-- The bug in full: Home.jsx used to insert straight into the table, keeping
-- whatever case the visitor typed. subscribe_newsletter() (20260814100000)
-- stores lower(trim(email)) and relies on `on conflict (email)` to turn a
-- re-subscribe into an update. `Sam@Gmail.com` and `sam@gmail.com` are two
-- distinct values in a plain unique index, so the legacy row never wins the
-- conflict: the same human ends up with two rows, two unsubscribe tokens and
-- two copies of every campaign — and clicking the opt-out link in one of them
-- leaves the other subscribed. That defeats the feature 20260814100000 exists
-- to provide, so it has to be fixed in the DATA as well as in the code path.

-- ---- 1a. Collapse rows that only differ by case/whitespace ---------------
-- Runs BEFORE the lowercasing update below, because lowercasing in place would
-- otherwise hit the unique index on `email` (23505) the moment both variants
-- of an address exist.
--
-- COLLISION STRATEGY
--   survivor        = the OLDEST row in the group (subscribed_at asc, NULLs
--                     last so a row with no timestamp never outranks a dated
--                     one; id asc breaks exact ties deterministically).
--   unsubscribed_at = min() across the whole group. min() ignores NULLs, so if
--                     ANY duplicate had opted out the survivor stays opted out,
--                     stamped with the EARLIEST opt-out. OPT-OUT ALWAYS WINS —
--                     a merge must never resurrect someone who unsubscribed.
--   discount_sent   = bool_or() across the group, so a merge cannot re-arm a
--                     welcome discount that was already sent to one variant.
--   first/last name = the survivor's own if it has one, otherwise any non-blank
--                     value from the group (min() over the trimmed text, which
--                     is deterministic and ignores NULLs) — so merging never
--                     silently loses the only name we hold for that address.
--   losers          = deleted.
--
-- On the tokens carried by the deleted rows: they die with the row, so a link
-- already mailed for a loser would start answering not_found. That is
-- acceptable here and only here — 20260814100000 shipped the token column
-- ("legal requirement BEFORE the first campaign goes out") and generated every
-- token in that same migration, so no unsubscribe link has been mailed yet.
-- The survivor keeps a working token, which is the one future campaigns use.
--
-- Idempotent: on a clean table every group has size 1, so both the update and
-- the delete match zero rows.
with ranked as (
  select id,
         lower(trim(email)) as norm_email,
         row_number() over (
           partition by lower(trim(email))
           order by subscribed_at asc nulls last, id asc
         ) as rn,
         count(*) over (partition by lower(trim(email))) as group_size
    from newsletter_subscribers
   where email is not null
),
dupes as (
  select r.id, r.norm_email, r.rn
    from ranked r
   where r.group_size > 1
),
merged_values as (
  select d.norm_email,
         min(s.unsubscribed_at)                                as opted_out_at,
         bool_or(coalesce(s.discount_sent, false))             as discount_sent,
         min(nullif(trim(coalesce(s.first_name, '')), ''))     as first_name,
         min(nullif(trim(coalesce(s.last_name,  '')), ''))     as last_name
    from dupes d
    join newsletter_subscribers s on s.id = d.id
   group by d.norm_email
),
survivors as (
  select d.id, d.norm_email from dupes d where d.rn = 1
),
-- Data-modifying CTE: executed exactly once and to completion even though the
-- primary statement never reads it. Touches only rn = 1 rows, while the DELETE
-- below touches only rn > 1 rows, so no tuple is written twice.
merge_survivor as (
  update newsletter_subscribers s
     set unsubscribed_at = coalesce(m.opted_out_at, s.unsubscribed_at),
         discount_sent   = m.discount_sent,
         first_name      = coalesce(nullif(trim(coalesce(s.first_name, '')), ''), m.first_name),
         last_name       = coalesce(nullif(trim(coalesce(s.last_name,  '')), ''), m.last_name)
    from survivors v
    join merged_values m on m.norm_email = v.norm_email
   where s.id = v.id
  returning s.id
)
delete from newsletter_subscribers s
 using dupes d
 where s.id = d.id
   and d.rn > 1;

-- ---- 1b. Lowercase what is left -----------------------------------------
-- Safe now that 1a has removed every case-variant collision. The WHERE clause
-- makes it a no-op on a second run (and on an already-clean table).
update newsletter_subscribers
   set email = lower(trim(email))
 where email is not null
   and email <> lower(trim(email));

-- ---- 1c. Stop it drifting again -----------------------------------------
-- A NORMALISING TRIGGER, not `check (email = lower(email))`. The reason is the
-- policy surface: "newsletter_public_insert" (20260329172540) is still on the
-- table with `with check (true)`, so ANY holder of the anon key — the key that
-- ships in the browser bundle — can still insert directly, bypassing
-- subscribe_newsletter() entirely. Given that:
--
--   * a CHECK constraint turns such an insert into a raw 23505/23514 error
--     surfaced to a visitor who typed their address with a capital letter, and
--     protects the invariant only by refusing the subscription;
--   * a BEFORE trigger accepts the row and stores it correctly, which is what
--     the visitor actually wanted, and yields the same invariant.
--
-- The trigger also covers UPDATE, so an admin edit cannot reintroduce mixed
-- case either. Postgres fires BEFORE INSERT triggers ahead of ON CONFLICT
-- arbitration, so subscribe_newsletter()'s `on conflict (email)` still matches
-- correctly on the normalised value.
create or replace function newsletter_normalize_email()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.email := lower(trim(new.email));
  return new;
end;
$$;

-- No grants are issued or revoked here on purpose. Trigger functions are not
-- callable directly (Postgres rejects any non-trigger invocation), and EXECUTE
-- is checked at CREATE TRIGGER time rather than at fire time — so revoking the
-- implicit PUBLIC execute would buy nothing and risks nothing but confusion.

drop trigger if exists newsletter_subscribers_normalize_email on newsletter_subscribers;
create trigger newsletter_subscribers_normalize_email
  before insert or update of email on newsletter_subscribers
  for each row execute function newsletter_normalize_email();

comment on column newsletter_subscribers.email is
  'Always stored lower(trim(...)) — enforced by the newsletter_subscribers_normalize_email trigger so that subscribe_newsletter()''s on-conflict upsert can never miss an existing subscriber and create a duplicate (which would double-mail them and break opt-out).';


-- ============================================================
-- FIX 2 — first_order_only cannot be redeemed twice concurrently
-- ============================================================
-- discount_eval()'s first-order test is `exists (select 1 from orders where
-- user_id = p_uid and status <> 'cancelled')`. Under READ COMMITTED neither of
-- two concurrent transactions can see the other's uncommitted order row, so
-- two tabs (or one double-submitted button) can both pass it and both redeem
-- WELCOME10. 20260814103000 already closed the equivalent hole for
-- max_redemptions — lock the row, then re-check the cap in the UPDATE's WHERE
-- — but there is no row to lock for "this account has never ordered": the
-- conflicting row does not exist yet. So the serialisation point has to be the
-- ACCOUNT itself, via a transaction-scoped advisory lock keyed on the user id.
-- The second transaction then blocks until the first commits, re-runs
-- discount_eval() against the now-visible order, and is rejected with the
-- normal 'Discount code: That code is for first orders only'.
--
-- WHERE THE LOCK GOES, AND WHY IT IS UNCONDITIONAL: at the very top, right
-- after the caller is resolved, BEFORE any product row is locked. Taking it
-- later (just before the discount block, after the `for update` on products)
-- would create two lock orders — one transaction holding products and waiting
-- on the advisory lock while another holds the advisory lock and waits on the
-- same product — i.e. a deadlock, aborting a real order. One lock order for
-- every caller (account -> products -> discount_codes) makes that impossible.
-- Unconditional also means a double-submitted checkout serialises whether or
-- not a code is involved, which is a small bonus, and it costs nothing: the
-- key is per-account, so different customers never contend.
--
-- Everything else below is the 20260814103000 body VERBATIM — same 4-arg
-- signature with `p_discount_code text default null`, same auth requirement
-- and account-email override, same input caps, same per-item row locking and
-- member-only gate, same server-side pricing, same pre-discount free-shipping
-- threshold, same guarded stock decrement, same redemption accounting.
-- create-or-replace (NOT drop-and-recreate): the 4-arg signature already
-- exists in production and dropping it would break in-flight callers.
create or replace function place_cod_order(
  p_customer        jsonb,
  p_items           jsonb,
  p_payment_method  text,
  p_discount_code   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_email      text;
  v_item       jsonb;
  v_prod       products%rowtype;
  v_qty        int;
  v_items      jsonb := '[]'::jsonb;
  v_subtotal   int := 0;
  v_shipping   int;
  v_total      int;
  v_number     text;
  v_id         uuid;
  v_code_in    text := nullif(trim(coalesce(p_discount_code, '')), '');
  v_eval       jsonb;
  v_disc_code  text := null;
  v_disc_cents int := 0;
begin
  if v_uid is null then
    raise exception 'Sign in required to place an order';
  end if;

  -- THE ONE ADDITION over 20260814103000. Serialises this account's concurrent
  -- checkouts for the rest of the transaction; released automatically on
  -- commit or rollback. Taken here so the lock order is always
  -- account -> products -> discount_codes (see the header note).
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));

  select email into v_email from auth.users where id = v_uid;
  if coalesce(trim(v_email), '') = '' then
    raise exception 'Account has no email address';
  end if;

  if p_payment_method not in ('cash_on_delivery','card_on_delivery') then
    raise exception 'Invalid payment method';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'No items in order';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'Too many items in order';
  end if;
  if coalesce(trim(p_customer->>'name'), '') = ''
     or coalesce(trim(p_customer->>'phone'), '') = '' then
    raise exception 'Missing customer details';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_item->>'quantity')::int, 0);
    if v_qty < 1 or v_qty > 100 then
      raise exception 'Invalid quantity';
    end if;
    -- lock the product row so concurrent orders can't both pass the stock check
    select * into v_prod from products where id = (v_item->>'id')::uuid for update;
    if not found then raise exception 'Product not found'; end if;
    if not v_prod.is_available then raise exception 'Product "%" is unavailable', v_prod.name; end if;
    if v_prod.stock_quantity < v_qty then raise exception 'Insufficient stock for "%"', v_prod.name; end if;
    -- MEMBER-ONLY GATE (from 20260813150000 — unchanged)
    if v_prod.is_member_only and not exists (
      select 1 from memberships m
       where m.user_id = v_uid
         and m.status = 'active'
         and m.expires_at > now()
    ) then
      raise exception 'Product "%" is for members only', v_prod.name;
    end if;
    v_subtotal := v_subtotal + v_prod.price * v_qty;
    v_items := v_items || jsonb_build_object(
      'id', v_prod.id, 'name', v_prod.name, 'price', v_prod.price,
      'quantity', v_qty, 'slug', v_prod.slug
    );
  end loop;

  -- DISCOUNT (the one addition over 20260813150000).
  -- The client sends a CODE and nothing else. The value is re-derived here by
  -- discount_eval against v_subtotal, which was just computed from locked DB
  -- product rows — a client that lies about the amount has nothing to lie
  -- with. Re-validating (rather than trusting the earlier
  -- validate_discount_code preview) is what closes the gap where a code
  -- expires, runs out, or stops being the caller's first order between the
  -- Apply click and the Place Order click. Its first_order_only test is now
  -- also race-free: the advisory lock above means no other checkout for this
  -- account can be between its own check and its own commit.
  if v_code_in is not null then
    v_eval := discount_eval(v_code_in, v_subtotal, v_uid);
    if not coalesce((v_eval->>'valid')::boolean, false) then
      -- Prefixed so the frontend can recognise a discount rejection and clear
      -- the applied code instead of showing a bare database error.
      raise exception 'Discount code: %', v_eval->>'reason';
    end if;
    v_disc_code  := v_eval->>'code';
    v_disc_cents := (v_eval->>'discount_cents')::int;
    -- Clamp again at the point of use: even if a future edit to discount_eval
    -- loosened its own clamp, the total here can never go below zero.
    v_disc_cents := least(greatest(v_disc_cents, 0), v_subtotal);
  end if;

  -- FREE SHIPPING IS DECIDED ON THE **PRE-DISCOUNT** SUBTOTAL. Deliberate:
  -- if the threshold used the discounted figure, a customer with a R520 cart
  -- (free shipping) who applied WELCOME10 would drop to R468, lose free
  -- shipping, and have R80 added back — a "discount" that makes the order
  -- R28 MORE expensive than not using it. The threshold measures what the
  -- customer chose to buy; the discount is a reduction applied after that
  -- decision, so it can never silently take free shipping away.
  v_shipping := case when v_subtotal >= 50000 then 0 else 8000 end;
  v_total := (v_subtotal - v_disc_cents) + v_shipping;

  loop
    v_number := '224-' || upper(substr(md5(gen_random_uuid()::text), 1, 6));
    exit when not exists (select 1 from orders where order_number = v_number);
  end loop;

  insert into orders (
    customer_name, customer_email, customer_phone, items, subtotal, shipping_fee,
    discount_code, discount_cents,
    total, status, payment_method, order_number, status_history, shipping_address, user_id
  ) values (
    p_customer->>'name', v_email, p_customer->>'phone', v_items, v_subtotal, v_shipping,
    v_disc_code, v_disc_cents,
    v_total, 'pending', p_payment_method, v_number,
    jsonb_build_array(jsonb_build_object('status', 'pending', 'at', now())),
    jsonb_build_object(
      'street', p_customer->>'street', 'apartment', p_customer->>'apartment',
      'city', p_customer->>'city', 'province', p_customer->>'province',
      'postalCode', p_customer->>'postalCode'
    ),
    v_uid
  ) returning id into v_id;

  -- guarded decrement: aborts (rolls back the whole order) if another txn won
  for v_item in select * from jsonb_array_elements(v_items) loop
    update products
       set stock_quantity = stock_quantity - (v_item->>'quantity')::int
     where id = (v_item->>'id')::uuid
       and stock_quantity >= (v_item->>'quantity')::int;
    if not found then raise exception 'Insufficient stock'; end if;
  end loop;

  -- Redemption accounting, same shape as the guarded stock decrement above:
  -- take the row lock first, then increment behind a WHERE that re-checks the
  -- cap under that lock. discount_eval's earlier check is advisory — two
  -- concurrent checkouts can both pass it — so the last redemption of a
  -- capped code is settled here, and losing it rolls the whole order back
  -- rather than over-redeeming. Locked AFTER the product rows so every caller
  -- takes the same lock order (products, then discount_codes).
  if v_disc_code is not null then
    perform 1 from discount_codes where code = v_disc_code for update;
    update discount_codes
       set times_redeemed = times_redeemed + 1
     where code = v_disc_code
       and (max_redemptions is null or times_redeemed < max_redemptions);
    if not found then
      raise exception 'Discount code: that code has just been fully redeemed';
    end if;
  end if;

  return jsonb_build_object(
    'id', v_id, 'order_number', v_number,
    'subtotal', v_subtotal, 'shipping_fee', v_shipping,
    'discount_code', v_disc_code, 'discount_cents', v_disc_cents,
    'total', v_total, 'status', 'pending'
  );
end;
$$;

-- create-or-replace preserves the existing grants; they are re-stated anyway so
-- this file alone describes the final privilege set. The auth.uid() check
-- inside the function stays as defense-in-depth.
revoke execute on function place_cod_order(jsonb, jsonb, text, text) from public, anon;
grant  execute on function place_cod_order(jsonb, jsonb, text, text) to authenticated;


-- ============================================================
-- FIX 3 — /track totals reconcile on discounted orders
-- ============================================================
-- get_order_tracking() is still the 20260622130000 definition (nothing since
-- has redefined it — 20260806120000 and 20260808120000 only reference it in
-- comments), so it predates orders.discount_code / discount_cents. On a
-- discounted order the tracking page therefore renders Subtotal and Shipping
-- that do not add up to the Total it renders next to them — the customer's
-- own receipt appearing to be wrong is exactly the kind of thing that
-- generates "have I been overcharged?" mails.
--
-- The body below is that definition VERBATIM with two fields added. Unchanged:
-- SECURITY DEFINER + pinned search_path, `stable`, the both-factors WHERE
-- (order number AND matching email — no enumeration), the `limit 1`, and the
-- deliberately narrow field list (still no phone, no full address, no email).
-- discount_cents is NOT NULL DEFAULT 0 on the table, so the coalesce is belt
-- and braces for any row written before that default landed; it also keeps the
-- key present as a number rather than JSON null for older orders.
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
    'city',                o.shipping_address->>'city'
  )
  from orders o
  where o.order_number = upper(trim(p_order_number))
    and lower(o.customer_email) = lower(trim(p_email))
  limit 1;
$$;

-- Grant surface deliberately unchanged from 20260622130000: anon MUST keep
-- execute (the tracking page is used logged out, which is the whole point of
-- the order-number + email pair). create-or-replace preserves grants; the line
-- is re-stated so this file describes the final state.
grant execute on function get_order_tracking(text, text) to anon, authenticated;


-- ============================================================
-- Capability probe
-- ============================================================
-- Every fix above lives inside an EXISTING function signature or in table data,
-- so there is no new name a client could detect and nothing in pg_proc/pg_trigger
-- is exposed through PostgREST. This one-line marker is what the contract tests
-- probe so they skip cleanly until this migration is pushed instead of failing
-- against the old behaviour (same idiom as order_cancel_restocks(),
-- 20260814101000). Read-only, exposes no data.
create or replace function discount_newsletter_fixes_applied()
returns boolean
language sql
immutable
set search_path = public
as $$ select true $$;

grant execute on function discount_newsletter_fixes_applied() to anon, authenticated;
