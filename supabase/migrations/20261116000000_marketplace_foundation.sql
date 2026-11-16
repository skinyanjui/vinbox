-- VINBOX Cars production foundation. NOT APPLIED: requires a dedicated Supabase project.
-- Public publishing remains disabled in the current local-preview UI.
create extension if not exists pgcrypto;

create table if not exists public.market_vehicles (
 id uuid primary key default gen_random_uuid(),
 vin varchar(17) not null unique check (vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),
 model_year int not null check (model_year between 1981 and 2100),
 make text not null check (char_length(make) between 1 and 70),
 model text not null check (char_length(model) between 1 and 90),
 trim text,
 specifications jsonb not null default '{}'::jsonb,
 decoded_at timestamptz not null default now(),
 source text not null default 'NHTSA vPIC'
);
comment on table public.market_vehicles is 'Validated VIN identity. Do not expose the full VIN through public listing queries.';
alter table public.market_vehicles enable row level security;
revoke all on public.market_vehicles from anon, authenticated;

create table if not exists public.market_listings (
 id uuid primary key default gen_random_uuid(),
 vehicle_id uuid not null references public.market_vehicles(id) on delete restrict,
 seller_id uuid not null references auth.users(id) on delete cascade,
 public_title text not null check (char_length(public_title) between 5 and 180),
 public_specs jsonb not null default '{}'::jsonb,
 price_cents bigint not null check (price_cents between 100 and 1000000000),
 mileage_miles int not null check (mileage_miles between 0 and 1500000),
 city text not null check (char_length(city) between 2 and 80),
 title_status text not null check (title_status in ('clean','lien','salvage','rebuilt','unknown')),
 condition text not null check (condition in ('excellent','good','fair','needs-work')),
 known_issues text not null default '' check (char_length(known_issues)<=1200),
 description text not null default '' check (char_length(description)<=3000),
 seller_authorized boolean not null default false,
 status text not null default 'draft' check (status in ('draft','pending_review','active','sold','removed','rejected')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 published_at timestamptz,
 deleted_at timestamptz
);
create index if not exists market_listings_feed on public.market_listings(status,published_at desc,id) where status='active' and deleted_at is null;
create index if not exists market_listings_seller on public.market_listings(seller_id,created_at desc);
create index if not exists market_listings_city on public.market_listings(lower(city));
create index if not exists market_listings_price on public.market_listings(price_cents) where status='active';
create unique index if not exists market_one_active_vehicle_per_seller on public.market_listings(vehicle_id,seller_id)
 where status in ('active','pending_review') and deleted_at is null;
alter table public.market_listings enable row level security;
revoke all on public.market_listings from anon, authenticated;
grant select on public.market_listings to anon, authenticated;
grant insert, update on public.market_listings to authenticated;
create policy market_public_active_read on public.market_listings for select to anon, authenticated
 using (status='active' and deleted_at is null);
create policy market_owner_read on public.market_listings for select to authenticated
 using (seller_id=(select auth.uid()));
create policy market_owner_create_draft on public.market_listings for insert to authenticated
 with check(seller_id=(select auth.uid()) and status='draft' and seller_authorized);
create policy market_owner_edit on public.market_listings for update to authenticated
 using (seller_id=(select auth.uid()) and deleted_at is null)
 with check (seller_id=(select auth.uid()) and status in ('draft','pending_review','sold','removed'));
-- Seller-side activation is impossible under this policy: a separate moderator
-- service must verify listing/media before status changes to 'active'.
-- Do not grant client DELETE: use retention-aware soft deletion.

create table if not exists public.market_media (
 id uuid primary key default gen_random_uuid(),
 listing_id uuid not null references public.market_listings(id) on delete cascade,
 owner_id uuid not null references auth.users(id) on delete cascade,
 object_key text not null unique check (char_length(object_key) between 5 and 250),
 position smallint not null check (position between 0 and 11),
 mime_type text not null check (mime_type in ('image/jpeg','image/webp')),
 bytes int not null check(bytes between 1 and 5000000),
 created_at timestamptz not null default now(),
 unique(listing_id,position)
);
create index if not exists market_media_listing on public.market_media(listing_id,position);
alter table public.market_media enable row level security;
revoke all on public.market_media from anon,authenticated;
grant select on public.market_media to anon,authenticated;
grant insert,delete on public.market_media to authenticated;
create policy market_media_public on public.market_media for select to anon,authenticated
 using (exists (select 1 from public.market_listings l where l.id=listing_id and l.status='active' and l.deleted_at is null));
create policy market_media_owner_read on public.market_media for select to authenticated using(owner_id=(select auth.uid()));
create policy market_media_owner_insert on public.market_media for insert to authenticated
 with check(owner_id=(select auth.uid()) and exists(select 1 from public.market_listings l
 where l.id=listing_id and l.seller_id=(select auth.uid()) and l.status in ('draft','pending_review')));
create policy market_media_owner_delete on public.market_media for delete to authenticated
 using (owner_id=(select auth.uid()) and exists(select 1 from public.market_listings l
 where l.id=listing_id and l.seller_id=(select auth.uid()) and l.status='draft'));

create table if not exists public.market_conversations (
 id uuid primary key default gen_random_uuid(),
 listing_id uuid not null references public.market_listings(id),
 buyer_id uuid not null references auth.users(id) on delete cascade,
 seller_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(listing_id,buyer_id),
 check(buyer_id<>seller_id)
);
create index if not exists market_conversations_seller on public.market_conversations(seller_id,updated_at desc);
create index if not exists market_conversations_buyer on public.market_conversations(buyer_id,updated_at desc);
alter table public.market_conversations enable row level security;
revoke all on public.market_conversations from anon,authenticated;
grant select,insert on public.market_conversations to authenticated;
create policy market_participants_read on public.market_conversations for select to authenticated
 using ((select auth.uid()) in (buyer_id,seller_id));
create policy market_buyer_starts on public.market_conversations for insert to authenticated
 with check (buyer_id=(select auth.uid()) and exists (select 1 from public.market_listings l
 where l.id=listing_id and l.seller_id=seller_id and l.status='active' and l.deleted_at is null));

create table if not exists public.market_messages (
 id uuid primary key default gen_random_uuid(),
 conversation_id uuid not null references public.market_conversations(id) on delete cascade,
 sender_id uuid not null references auth.users(id) on delete cascade,
 body text not null check(char_length(body) between 1 and 2000),
 created_at timestamptz not null default now(),
 deleted_at timestamptz
);
create index if not exists market_messages_thread on public.market_messages(conversation_id,created_at,id);
alter table public.market_messages enable row level security;
revoke all on public.market_messages from anon,authenticated;
grant select,insert on public.market_messages to authenticated;
create policy market_message_participants on public.market_messages for select to authenticated
 using (exists(select 1 from public.market_conversations c where c.id=conversation_id
 and (select auth.uid()) in(c.buyer_id,c.seller_id)));
create policy market_message_send on public.market_messages for insert to authenticated
 with check (sender_id=(select auth.uid()) and exists(select 1 from public.market_conversations c
 where c.id=conversation_id and (select auth.uid()) in(c.buyer_id,c.seller_id)));

create table if not exists public.market_favorites (
 user_id uuid not null references auth.users(id) on delete cascade,
 listing_id uuid not null references public.market_listings(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(user_id,listing_id)
);
alter table public.market_favorites enable row level security;
revoke all on public.market_favorites from anon,authenticated;
grant select,insert,delete on public.market_favorites to authenticated;
create policy market_favorites_read on public.market_favorites for select to authenticated using(user_id=(select auth.uid()));
create policy market_favorites_insert on public.market_favorites for insert to authenticated
 with check(user_id=(select auth.uid()) and exists (select 1 from public.market_listings l where l.id=listing_id and l.status='active'));
create policy market_favorites_delete on public.market_favorites for delete to authenticated using(user_id=(select auth.uid()));

create table if not exists public.market_reports (
 id uuid primary key default gen_random_uuid(),
 reporter_id uuid not null references auth.users(id) on delete cascade,
 listing_id uuid references public.market_listings(id),
 message_id uuid references public.market_messages(id),
 reason text not null check(reason in ('spam','fraud','misleading','unsafe','other')),
 details text not null default '' check(char_length(details)<=2000),
 created_at timestamptz not null default now(),
 status text not null default 'new' check(status in ('new','reviewing','resolved')),
 check(listing_id is not null or message_id is not null)
);
alter table public.market_reports enable row level security;
revoke all on public.market_reports from anon,authenticated;
grant insert on public.market_reports to authenticated;
create policy market_reports_submit on public.market_reports for insert to authenticated
 with check (reporter_id=(select auth.uid()) and status='new');
-- Reports are private to support/admin processes. Never grant clients SELECT.

-- Private image uploads, owned under user-ID path; server-issued signed URLs
-- and re-encoding/EXIF removal are required before a public release.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values ('vinbox-cars','vinbox-cars',false,5000000,array['image/jpeg','image/webp'])
 on conflict (id) do nothing;
create policy market_storage_owner_upload on storage.objects for insert to authenticated
 with check(bucket_id='vinbox-cars' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy market_storage_owner_read on storage.objects for select to authenticated
 using(bucket_id='vinbox-cars' and owner_id=(select auth.uid())::text);
create policy market_storage_owner_delete on storage.objects for delete to authenticated
 using(bucket_id='vinbox-cars' and owner_id=(select auth.uid())::text);

-- Follow up before public activation: secure server-side NHTSA validation,
-- rate limits, moderator-only publication, server-side image rewriting,
-- mail delivery/abuse reporting, GDPR/CCPA retention and audit events.
