-- ============================================================
-- 224 Clubhouse — membership perks reworded for delivery-only (2026-10-05)
-- ============================================================
-- The club is closed until further notice and delivers only, so perks that
-- described the lounge ("lounge access", "Wi-Fi + amenities", "priority
-- seating", "the full floor", "daily sessions") no longer apply. Wording
-- approved by the owner on 2026-10-05. Prices and durations are unchanged.
-- Admins can still edit perks afterwards in Admin → Memberships.
-- ============================================================

update membership_tiers set perks = jsonb_build_array(
  'Free delivery on every order for 24 hours',
  'Shop members-only products',
  'Keep ordering: no limit after your first order',
  'Join the 224 community'
) where slug = 'daily';

update membership_tiers set perks = jsonb_build_array(
  'Free delivery on every order for 7 days',
  'Event invitations',
  'Shop members-only products',
  'Keep ordering: no limit after your first order',
  'Early access to new stock'
) where slug = 'weekly';

update membership_tiers set perks = jsonb_build_array(
  'Free delivery on every order for 30 days',
  'Priority event invitations',
  'Exclusive member perks',
  'Early access to product drops',
  'Member-only discounts',
  'Shop members-only products'
) where slug = 'monthly';
