-- STAGED PROPOSAL ONLY. Do not apply to an unrelated database.
-- Requires public.market_listings from the reviewed VINBOX foundation migration.
-- Public browsing uses the caller's RLS privileges; drafts and deleted rows are excluded.
-- Populate public_specs with validated, PUBLIC-SAFE make/model/trim/body/fuel/year fields
-- during publication. Do not copy VINs, seller contact information, or private remarks.
-- Client passes parsed query terms/price/year/type filters to this RPC. Never log VIN queries.

create index if not exists market_listings_public_search_fts
 on public.market_listings using gin (
  to_tsvector('simple'::regconfig,
   coalesce(public_title,'') || ' ' || coalesce(city,'') || ' ' ||
   coalesce(public_specs->>'make','') || ' ' ||
   coalesce(public_specs->>'model','') || ' ' ||
   coalesce(public_specs->>'trim','') || ' ' ||
   coalesce(public_specs->>'body','') || ' ' ||
   coalesce(public_specs->>'fuel',''))
 )
 where status='active' and deleted_at is null;

create index if not exists market_listings_public_price
 on public.market_listings(price_cents,id)
 where status='active' and deleted_at is null;

create or replace function public.market_search_public(
 p_query text default null,
 p_min_price_cents bigint default null,
 p_max_price_cents bigint default null,
 p_sort text default 'relevant',
 p_type text default 'all',
 p_limit integer default 20,
 p_offset integer default 0
)
returns table (
 id uuid,
 public_title text,
 price_cents bigint,
 mileage_miles integer,
 city text,
 title_status text,
 condition text,
 published_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $function$
 select l.id,l.public_title,l.price_cents,l.mileage_miles,l.city,
  l.title_status,l.condition,l.published_at
 from public.market_listings as l
 where l.status='active' and l.deleted_at is null
  and (p_min_price_cents is null or l.price_cents >= greatest(0,p_min_price_cents))
  and (p_max_price_cents is null or l.price_cents <= greatest(0,p_max_price_cents))
  and (
   p_type is null or p_type='all' or
   case p_type
    when 'suv' then coalesce(l.public_specs->>'body','') ~* '(crossover|sport utility|suv|off-road|multi-purpose)'
    when 'truck' then coalesce(l.public_specs->>'body','') ~* '(pickup|truck)'
    when 'passenger' then coalesce(l.public_specs->>'body','') ~* '(sedan|hatchback|wagon|liftback|coupe|convertible|roadster)'
    when 'van' then coalesce(l.public_specs->>'body','') ~* '(minivan|van)'
    when 'electric' then lower(coalesce(l.public_specs->>'fuel','')) in ('electric','electricity','battery electric')
    else false
   end
  )
  and (
   nullif(btrim(left(p_query,120)),'') is null or
   to_tsvector('simple'::regconfig,
    coalesce(l.public_title,'') || ' ' || coalesce(l.city,'') || ' ' ||
    coalesce(l.public_specs->>'make','') || ' ' ||
    coalesce(l.public_specs->>'model','') || ' ' ||
    coalesce(l.public_specs->>'trim','') || ' ' ||
    coalesce(l.public_specs->>'body','') || ' ' ||
    coalesce(l.public_specs->>'fuel',''))
   @@ websearch_to_tsquery('simple'::regconfig,left(p_query,120))
  )
 order by
  case when p_sort='price-asc' then l.price_cents end asc nulls last,
  case when p_sort='price-desc' then l.price_cents end desc nulls last,
  case when p_sort='mileage-asc' then l.mileage_miles end asc nulls last,
  case when p_sort='newest' and l.public_specs->>'year' ~ '^(19[8-9][0-9]|20[0-9][0-9])$'
   then (l.public_specs->>'year')::integer end desc nulls last,
  case when coalesce(p_sort,'relevant')='relevant' and nullif(btrim(left(p_query,120)),'') is not null
   then ts_rank(
    to_tsvector('simple'::regconfig,
     coalesce(l.public_title,'') || ' ' || coalesce(l.city,'') || ' ' ||
     coalesce(l.public_specs->>'make','') || ' ' ||
     coalesce(l.public_specs->>'model','') || ' ' ||
     coalesce(l.public_specs->>'trim','') || ' ' ||
     coalesce(l.public_specs->>'body','') || ' ' ||
     coalesce(l.public_specs->>'fuel','')),
    websearch_to_tsquery('simple'::regconfig,left(p_query,120))
   ) end desc nulls last,
  l.published_at desc nulls last, l.id asc
 limit greatest(1,least(coalesce(p_limit,20),50))
 offset greatest(0,least(coalesce(p_offset,0),1000));
$function$;

revoke all on function public.market_search_public(text,bigint,bigint,text,text,integer,integer)
 from public;
grant execute on function public.market_search_public(text,bigint,bigint,text,text,integer,integer)
 to anon,authenticated;

-- Deployment gate (this file is not a migration; DO NOT apply automatically):
-- * Confirm active listings contain validated public_specs (year/make/model/body/fuel).
-- * Run SQL parser and EXPLAIN ANALYZE on provisioned VINBOX test data.
-- * Verify owner/anon/authenticated RLS, column grants and no indirect VIN leak.
-- * Ensure publicly readable market_listings columns are deliberately restricted;
--   a whitelisted RPC alone does not prevent direct REST reads if broad grants remain.
-- * Test all types, sort paths, empty searches, malformed fields and pagination.
-- * Enforce rate limits, privacy-preserving logs and keyset pagination at scale.
