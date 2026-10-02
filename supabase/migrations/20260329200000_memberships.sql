-- ============================================================
-- 224 Clubhouse — Memberships Table
-- ============================================================

create table if not exists memberships (
  id                  uuid primary key default gen_random_uuid(),
  full_name           text not null,
  email               text not null,
  phone               text not null,
  date_of_birth       date not null,
  id_number           text,
  tier                text not null check (tier in ('daily','weekly','monthly')),
  status              text not null default 'active'
                      check (status in ('pending','active','expired','cancelled')),
  amount              integer not null,
  paystack_reference  text unique,
  starts_at           timestamptz default now(),
  expires_at          timestamptz,
  created_at          timestamptz default now()
);

alter table memberships enable row level security;

-- Anyone can apply (insert)
create policy "memberships_public_insert" on memberships for insert with check (true);
-- Only admins can read/update
create policy "memberships_auth_select" on memberships for select using (auth.role() = 'authenticated');
create policy "memberships_auth_update" on memberships for update using (auth.role() = 'authenticated');
create policy "memberships_auth_delete" on memberships for delete using (auth.role() = 'authenticated');
