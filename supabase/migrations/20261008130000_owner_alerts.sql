-- ============================================================
-- 224 Clubhouse — owner alerts: daily summary (2026-10-08)
-- ============================================================
-- Every morning at 07:00 Johannesburg (05:00 UTC) pg_cron calls the
-- send-daily-summary Edge Function, which emails the club (ADMIN_ALERT_EMAIL)
-- yesterday's numbers plus what is waiting: EFT payments to check, low stock,
-- reviews and membership applications. It is always sent, as a heartbeat.
--
-- daily_summary_data() does all the counting in SQL and is service-role only:
-- it returns customer counts and stock that the public must not query.
--
-- CRON SECRET: the vault secret `cart_reminders_cron_secret` (created for the
-- cart reminders, 20261005150000) is now the SHARED cron secret for every
-- cron-called function; each one compares it to its CRON_SECRET env var.
-- The other new owner alerts (low stock in the new-order email, review
-- waiting) live in the Edge Functions and need no SQL.
-- ============================================================

create or replace function daily_summary_data(p_day date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_start timestamptz := p_day::timestamp at time zone 'Africa/Johannesburg';
  v_end   timestamptz := (p_day + 1)::timestamp at time zone 'Africa/Johannesburg';
begin
  return jsonb_build_object(
    'day', p_day,
    'visitors',   (select count(distinct visitor_id) from site_events
                    where created_at >= v_start and created_at < v_end),
    'page_views', (select count(*) from site_events
                    where event = 'page_view' and created_at >= v_start and created_at < v_end),
    'new_accounts', (select count(*) from auth.users
                      where created_at >= v_start and created_at < v_end
                        and coalesce(email, '') not like 'vitest+%'),
    'orders', (select count(*) from orders
                where created_at >= v_start and created_at < v_end
                  and status <> 'cancelled' and customer_email not like 'vitest+%'),
    'booked_cents', (select coalesce(sum(total), 0) from orders
                      where created_at >= v_start and created_at < v_end
                        and status <> 'cancelled' and customer_email not like 'vitest+%'),
    -- Delivered YESTERDAY (by the delivered entry in status_history), whenever placed.
    'delivered', (select count(*) from orders o
                   where o.status = 'delivered' and o.customer_email not like 'vitest+%'
                     and exists (select 1 from jsonb_array_elements(coalesce(o.status_history, '[]'::jsonb)) h
                                  where h->>'status' = 'delivered'
                                    and (h->>'at')::timestamptz >= v_start and (h->>'at')::timestamptz < v_end)),
    'delivered_cents', (select coalesce(sum(o.total), 0) from orders o
                   where o.status = 'delivered' and o.customer_email not like 'vitest+%'
                     and exists (select 1 from jsonb_array_elements(coalesce(o.status_history, '[]'::jsonb)) h
                                  where h->>'status' = 'delivered'
                                    and (h->>'at')::timestamptz >= v_start and (h->>'at')::timestamptz < v_end)),
    -- Waiting NOW (same definition as eftState in src/utils/orderStatus.js).
    'eft_awaiting', (select count(*) from orders
                      where payment_method = 'eft' and paid_at is null
                        and status not in ('delivered', 'cancelled')
                        and payment_proof_uploaded_at is null
                        and customer_email not like 'vitest+%'),
    'eft_proof', (select count(*) from orders
                   where payment_method = 'eft' and paid_at is null
                     and status not in ('delivered', 'cancelled')
                     and payment_proof_uploaded_at is not null
                     and customer_email not like 'vitest+%'),
    'reviews_pending', (select count(*) from product_reviews where status = 'pending'),
    'memberships_pending', (select count(*) from memberships where status = 'pending'),
    'low_stock', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'left', left_qty) order by left_qty, name)
        from (
          select p.name, p.stock_quantity as left_qty
            from products p
           where p.is_available and p.stock_quantity <= 5
             and p.slug not like 'vitest-%'
             and not exists (select 1 from product_variants v where v.product_id = p.id)
          union all
          select p.name || ' — ' || v.label, v.stock_quantity
            from product_variants v join products p on p.id = v.product_id
           where p.is_available and v.is_available and v.stock_quantity <= 5
             and p.slug not like 'vitest-%'
           limit 30
        ) s
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function daily_summary_data(date) from public, anon, authenticated;
grant  execute on function daily_summary_data(date) to service_role;

select cron.unschedule(jobid) from cron.job where jobname = 'send-daily-summary';
select cron.schedule(
  'send-daily-summary',
  '0 5 * * *',
  $cron$
  select net.http_post(
    url := 'https://aogdkqczvlffgydgxsmz.supabase.co/functions/v1/send-daily-summary',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                         where name = 'cart_reminders_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $cron$
);
