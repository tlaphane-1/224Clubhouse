-- ============================================================
-- Per-store owner alert recipients (2026-11-07)
-- ============================================================
-- Owner decision: Explosive 420's alerts (new order, EFT proof, membership
-- application, review) must not reach 224's inbox. alert_settings is already
-- one row per store, so the recipients live there.
--
-- alert_emails: comma-separated addresses. NULL keeps today's behaviour for
-- 224 only: the Edge Functions fall back to the ADMIN_ALERT_EMAIL secret for
-- 224 and send no email for any other store (supabase/functions/_shared/
-- storeAlerts.ts). The table has RLS on and no policies; only the service role
-- reads it, so the column needs no grant.
-- ============================================================

alter table public.alert_settings add column if not exists alert_emails text;
