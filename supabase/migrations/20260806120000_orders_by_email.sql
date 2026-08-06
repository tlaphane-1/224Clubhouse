-- 20260806120000_orders_by_email.sql
-- Look up a customer's orders by email alone, so someone who never wrote down an
-- order number can still find it (owner decision, 2026-08-06).
--
-- TRADE-OFF, STATED PLAINLY: get_order_tracking deliberately requires order number
-- AND email so nobody can enumerate another person's orders. This function relaxes
-- that — anyone who knows or guesses an email address can list that address's
-- orders. The owner accepted this to fix customers being unable to find their own
-- orders. It is narrowed as far as it can be without blocking the use case:
--   * returns a summary only — no name, phone, address, or line items
--   * capped at the 20 most recent
--   * exact (case/whitespace-insensitive) email match, no partial or wildcard
-- Full detail still requires the order number via get_order_tracking.
--
-- Worth adding later: rate limiting at the edge, or an emailed magic link, which
-- would remove the enumeration exposure entirely.

create or replace function get_orders_by_email(p_email text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with recent as (
    select
      o.order_number,
      o.status,
      o.total,
      o.created_at,
      case when jsonb_typeof(o.items) = 'array'
           then jsonb_array_length(o.items)
           else 0
      end as item_count
    from orders o
    where lower(trim(o.customer_email)) = lower(trim(p_email))
    order by o.created_at desc
    limit 20
  )
  select coalesce(jsonb_agg(to_jsonb(recent) order by recent.created_at desc), '[]'::jsonb)
  from recent;
$$;

grant execute on function get_orders_by_email(text) to anon, authenticated;
