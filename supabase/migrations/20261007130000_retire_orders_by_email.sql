-- ============================================================
-- 224 Clubhouse — retire the email-only order lookup (2026-10-07)
-- ============================================================
-- get_orders_by_email (20260806120000) let anyone list the orders for any
-- email address they could guess. It was accepted knowingly as a stopgap for
-- orders placed before customer accounts existed (2026-08-08). The owner has
-- now retired it. /track still works with order number + email together
-- (get_order_tracking), and signed-in customers see their orders on /orders.
-- ============================================================

drop function if exists get_orders_by_email(text);
