-- ============================================================
-- 224 Clubhouse — Initial Schema
-- ============================================================

-- Products
create table if not exists products (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  description      text,
  price            integer not null,
  category         text not null check (category in ('flower','edibles','accessories','merchandise')),
  stock_quantity   integer not null default 0,
  is_available     boolean not null default true,
  is_member_only   boolean not null default false,
  images           text[] default '{}',
  strain_type      text check (strain_type in ('indica','sativa','hybrid')),
  thc_percentage   numeric,
  weight_grams     numeric,
  slug             text unique not null,
  created_at       timestamptz default now()
);

-- Orders
create table if not exists orders (
  id                  uuid primary key default gen_random_uuid(),
  customer_name       text not null,
  customer_email      text not null,
  customer_phone      text not null,
  items               jsonb not null,
  subtotal            integer not null,
  shipping_fee        integer not null,
  total               integer not null,
  status              text not null default 'pending'
                      check (status in ('pending','paid','processing','shipped','delivered','cancelled')),
  paystack_reference  text unique,
  shipping_address    jsonb not null,
  created_at          timestamptz default now()
);

-- Events
create table if not exists events (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  description      text,
  date             date not null,
  time             text,
  location         text default '224 Rondebult Ave, Libradene, Boksburg',
  image_url        text,
  is_members_only  boolean default false,
  ticket_price     integer,
  created_at       timestamptz default now()
);

-- Newsletter Subscribers
create table if not exists newsletter_subscribers (
  id             uuid primary key default gen_random_uuid(),
  email          text unique not null,
  first_name     text,
  last_name      text,
  subscribed_at  timestamptz default now(),
  discount_sent  boolean default false
);

-- ============================================================
-- Row Level Security
-- ============================================================

alter table products enable row level security;
alter table orders enable row level security;
alter table events enable row level security;
alter table newsletter_subscribers enable row level security;

create policy "products_public_select" on products for select using (true);
create policy "products_auth_insert" on products for insert with check (auth.role() = 'authenticated');
create policy "products_auth_update" on products for update using (auth.role() = 'authenticated');
create policy "products_auth_delete" on products for delete using (auth.role() = 'authenticated');

create policy "orders_auth_all" on orders for all using (auth.role() = 'authenticated');

create policy "events_public_select" on events for select using (true);
create policy "events_auth_insert" on events for insert with check (auth.role() = 'authenticated');
create policy "events_auth_update" on events for update using (auth.role() = 'authenticated');
create policy "events_auth_delete" on events for delete using (auth.role() = 'authenticated');

create policy "newsletter_public_insert" on newsletter_subscribers for insert with check (true);
create policy "newsletter_auth_select" on newsletter_subscribers for select using (auth.role() = 'authenticated');

-- ============================================================
-- Helpers
-- ============================================================

create or replace function decrement_stock(product_id uuid, qty integer)
returns void as $$
  update products set stock_quantity = greatest(0, stock_quantity - qty) where id = product_id;
$$ language sql security definer;

-- ============================================================
-- Storage Buckets
-- ============================================================

insert into storage.buckets (id, name, public)
  values ('product-images', 'product-images', true)
  on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
  values ('event-images', 'event-images', true)
  on conflict (id) do nothing;

create policy "product_images_public_read" on storage.objects
  for select using (bucket_id = 'product-images');

create policy "product_images_auth_upload" on storage.objects
  for insert with check (bucket_id = 'product-images' and auth.role() = 'authenticated');

create policy "product_images_auth_delete" on storage.objects
  for delete using (bucket_id = 'product-images' and auth.role() = 'authenticated');

create policy "event_images_public_read" on storage.objects
  for select using (bucket_id = 'event-images');

create policy "event_images_auth_upload" on storage.objects
  for insert with check (bucket_id = 'event-images' and auth.role() = 'authenticated');

create policy "event_images_auth_delete" on storage.objects
  for delete using (bucket_id = 'event-images' and auth.role() = 'authenticated');
