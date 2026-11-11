-- Parliamentary process (Whips Hub): questions about procedure answered from Erskine May (read live from its API) and the Lords Companion (uploaded as a PDF, kept here in pieces so it can be searched).
create table if not exists public.process_chunks (
  id        bigserial primary key,
  source    text not null default 'companion',
  edition   text not null default '',
  ref       text not null default '',     -- the paragraph number, e.g. 7.12
  heading   text not null default '',
  page      int,
  body      text not null,
  tsv       tsvector generated always as (to_tsvector('english', coalesce(heading, '') || ' ' || body)) stored
);
create index if not exists process_chunks_tsv_idx on public.process_chunks using gin (tsv);
create index if not exists process_chunks_source_idx on public.process_chunks (source);

create table if not exists public.process_questions (
  id          bigserial primary key,
  question    text not null,
  house       text not null default '',
  asked_by    text,
  answer      text not null default '',
  sources     jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists process_questions_created_idx on public.process_questions (created_at desc);

-- The best-matching pieces of the Lords Companion for a question (websearch syntax: quoted phrases, or, -not).
create or replace function public.search_process(q text, max_results int default 8)
returns table (id bigint, ref text, heading text, page int, body text, edition text, rank real)
language sql stable set search_path = public, pg_catalog as $$
  select c.id, c.ref, c.heading, c.page, c.body, c.edition, ts_rank_cd(c.tsv, websearch_to_tsquery('english', q)) as rank
  from process_chunks c
  where c.source = 'companion' and c.tsv @@ websearch_to_tsquery('english', q)
  order by rank desc
  limit max_results
$$;
revoke execute on function public.search_process(text, int) from public, anon, authenticated;
grant execute on function public.search_process(text, int) to service_role;

alter table public.process_chunks enable row level security;
alter table public.process_questions enable row level security;
revoke all on public.process_chunks, public.process_questions from anon, authenticated;
revoke all on sequence public.process_chunks_id_seq, public.process_questions_id_seq from anon, authenticated;
