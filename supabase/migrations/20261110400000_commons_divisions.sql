-- House of Commons divisions (Commons Votes API), for the Commons side of the Data page's Voting Data. Same shape as lords_divisions:
-- content = Ayes, not_content = Noes, parties = { "Party name": { c: Ayes, nc: Noes } }.
create table if not exists public.commons_divisions (
  division_id   int primary key,
  number        int,
  division_date date not null,
  title         text not null default '',
  content       int not null default 0,
  not_content   int not null default 0,
  parties       jsonb not null default '{}'::jsonb,
  fetched_at    timestamptz not null default now()
);
create index if not exists commons_divisions_date_idx on public.commons_divisions (division_date);
alter table public.commons_divisions enable row level security;
revoke all on public.commons_divisions from anon, authenticated;
