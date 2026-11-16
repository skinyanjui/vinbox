-- PROPOSAL ONLY, NOT APPLIED. Dedicated VINBOX Supabase project required.
-- Apply after foundation schema, via a generated Supabase migration and security review.
-- The public search RPC uses caller's RLS privileges, only returns active listings,
-- never reads market_vehicles (which contains confidential VINs).
create index if not exists market_listings_public_search_fts
 on public.market_listings using gin
 (to_tsvector('simple'::regconfig, public_title || ' ' || city))
 where status='active' and deleted_at is null;

-- The optional model-year index is deferred until its historical data is validated.

create or replace function public.market_search_public(
 p_query text default null,
 p_min_price_cents bigint default null,
 p_max_price_cents bigint default null,
 p_sort text default 'relevant',
 p_limit integer default 20,
 p_offset integer default 0
)
returns table(
 id uuid, public_title text, price_cents bigint, mileage_miles integer,
 city text, title_status text, condition text, published_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $function$
 select l.id,l.public_title,l.price_cents,l.mileage_miles,
        l.city,l.title_status,l.condition,l.published_at
 from public.market_listings l
 where l.status='active' and l.deleted_at is null
   and (p_min_price_cents is null or l.price_cents >= greatest(0,p_min_price_cents))
   and (p_max_price_cents is null or l.price_cents <= greatest(0,p_max_price_cents))
   and (nullif(btrim(left(p_query,120)),'') is null or
     to_tsvector('simple'::regconfig,l.public_title || ' ' || l.city)
       @@ websearch_to_tsquery('simple'::regconfig,left(p_query,120)))
 order by
  case when p_sort='price-asc' then l.price_cents end asc nulls last,
  case when p_sort='price-desc' then l.price_cents end desc nulls last,
  case when p_sort='mileage-asc' then l.mileage_miles end asc nulls last,
  case when p_sort='newest' and l.public_specs->>'year' ~ '^(19[8-9][0-9]|20[0-9][0-9])
  case when p_sort='relevant' and nullif(btrim(left(p_query,120)),'') is not null
       then ts_rank(to_tsvector('simple'::regconfig,l.public_title || ' ' || l.city),
          websearch_to_tsquery('simple'::regconfig,left(p_query,120))) end desc nulls last,
  l.published_at desc nulls last, l.id asc
 limit greatest(1,least(coalesce(p_limit,20),50))
 offset greatest(0,least(coalesce(p_offset,0),1000));
$function$;

revoke all on function public.market_search_public(text,bigint,bigint,text,integer,integer)
 from public;
grant execute on function public.market_search_public(text,bigint,bigint,text,integer,integer)
 to anon,authenticated;

-- Acceptance when a VINBOX database is provisioned:
-- 1. Set role anon; confirm all inactive, sold and soft-deleted rows are excluded.
-- 2. Query quoted multiword searches, Unicode, empty input, price bounds and page edges.
-- 3. Confirm VIN and seller_id never appear in RPC output or EXPLAIN payload.
-- 4. EXPLAIN ANALYZE full-text filter/price sort on representative volume.
-- 5. Verify rate limiting at the API layer, and validate grants/RLS with auth users.
-- 6. Use keyset pagination before allowing more than 1,000 offset rows.

       then (l.public_specs->>'year')::integer end desc nulls last,
  case when p_sort='relevant' and nullif(btrim(left(p_query,120)),'') is not null
       then ts_rank(to_tsvector('simple'::regconfig,l.public_title || ' ' || l.city),
          websearch_to_tsquery('simple'::regconfig,left(p_query,120))) end desc nulls last,
  l.published_at desc nulls last, l.id asc
 limit greatest(1,least(coalesce(p_limit,20),50))
 offset greatest(0,least(coalesce(p_offset,0),1000));
$function$;

revoke all on function public.market_search_public(text,bigint,bigint,text,integer,integer)
 from public;
grant execute on function public.market_search_public(text,bigint,bigint,text,integer,integer)
 to anon,authenticated;

-- Acceptance when a VINBOX database is provisioned:
-- 1. Set role anon; confirm all inactive, sold and soft-deleted rows are excluded.
-- 2. Query quoted multiword searches, Unicode, empty input, price bounds and page edges.
-- 3. Confirm VIN and seller_id never appear in RPC output or EXPLAIN payload.
-- 4. EXPLAIN ANALYZE full-text filter/price sort on representative volume.
-- 5. Verify rate limiting at the API layer, and validate grants/RLS with auth users.
-- 6. Use keyset pagination before allowing more than 1,000 offset rows.
