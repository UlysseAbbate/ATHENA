-- LUCIEN: a permanent archive of everything the collector finds (select committee reports and government responses, think tank publications, media coverage, polling).
-- The live feed (ulysse_data 'feed') keeps the last 180 days; this table keeps all of it, for ever, and can be searched. Only the collector writes to it (through the ingest function).
create table if not exists public.lucien_archive (
  id         text primary key,                     -- the item's id in the feed (a hash of its address)
  category   text not null,                        -- committee | thinktank | media | polling
  source     text not null,
  title      text not null,
  url        text not null,
  published  timestamptz,
  first_seen timestamptz not null default now(),
  summary    text,
  tags       text[] not null default '{}',
  item       jsonb not null default '{}'::jsonb,   -- everything else the collector worked out (policy area, kind, status ...)
  search     tsvector generated always as (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(source, ''))) stored
);
create index if not exists lucien_archive_published_idx on public.lucien_archive (published desc nulls last);
create index if not exists lucien_archive_category_idx on public.lucien_archive (category, published desc nulls last);
create index if not exists lucien_archive_source_idx on public.lucien_archive (source);
create index if not exists lucien_archive_search_idx on public.lucien_archive using gin (search);
alter table public.lucien_archive enable row level security;
create policy lucien_archive_read on public.lucien_archive for select to authenticated
  using ((select public.is_admin()) or (select public.can('ulysse', 'read')));
-- no insert / update / delete policies: only the service role (the ingest function) writes
