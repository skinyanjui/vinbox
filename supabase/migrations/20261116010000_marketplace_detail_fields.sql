-- Staged alongside the marketplace foundation. Apply before enabling public listing APIs.
alter table public.market_listings
 add column lien_status text not null default 'unknown' check (lien_status in ('yes','no','unknown')),
 add column issues_status text not null default 'unknown' check (issues_status in ('listed','none','unknown')),
 add column exterior_color text not null default '' check (char_length(exterior_color)<=50),
 add column maintenance text not null default '' check (char_length(maintenance)<=600),
 add column stock_number text not null default '' check (char_length(stock_number)<=40),
 add column dealer_fee_cents bigint check (dealer_fee_cents between 0 and 1000000000);

-- A legacy lien does not tell us how the title is branded.
update public.market_listings set title_status='unknown',lien_status='yes' where title_status='lien';
update public.market_listings set issues_status='listed' where char_length(btrim(known_issues))>0;

alter table public.market_listings
 drop constraint market_listings_title_status_check,
 add constraint market_listings_title_status_check check (title_status in ('clean','salvage','rebuilt','unknown'));
