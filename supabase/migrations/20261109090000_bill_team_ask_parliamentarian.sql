-- A Bill's team: the existing column `advisers` is the Lords adviser; add the Lords Bill lead and the Commons adviser and Bill lead.
alter table public.bill_advisers add column if not exists lords_lead text;
alter table public.bill_advisers add column if not exists commons_adviser text;
alter table public.bill_advisers add column if not exists commons_lead text;

-- Ask a Parliamentarian: anyone asks for help (attend an AGM, work experience support ...) by a date; parliamentarians or their staff offer support.
-- (It replaces Work Experience Support, whose tables are left in place, unused.)
create table if not exists public.ask_requests (
  id          bigserial primary key,
  requester   text not null,
  contact     text,
  kind        text not null default 'other',
  title       text not null,
  details     text,
  needed_by   date not null,
  event_date  date,
  created_at  timestamptz default now()
);
create table if not exists public.ask_offers (
  id          bigserial primary key,
  request_id  bigint not null references public.ask_requests(id) on delete cascade,
  who         text not null,
  note        text,
  created_at  timestamptz default now()
);
create index if not exists ask_requests_needed_by_idx on public.ask_requests (needed_by);
create index if not exists ask_offers_request_idx on public.ask_offers (request_id);
alter table public.ask_requests enable row level security;
alter table public.ask_offers enable row level security;
-- like the rest of LIBBY's tables, the browser never talks to these: the API does, with the service role
revoke all on public.ask_requests, public.ask_offers from anon, authenticated;
revoke all on sequence public.ask_requests_id_seq, public.ask_offers_id_seq from anon, authenticated;
