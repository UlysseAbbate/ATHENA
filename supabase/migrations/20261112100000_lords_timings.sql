-- Lords timings:
--  debate_speakers: the speakers' list (and the advisory backbench speaking time) uploaded about 48 hours before a debate, before the Today's List exists.
--  group_actuals:   when each group of amendments really started at Committee/Report, noted by Staff, so the groups still to come can be re-timed.
create table if not exists public.debate_speakers (
  list_date        date not null,
  title_key        text not null,                 -- the debate's title as a slug (first 48 characters), the same whichever paper it comes from
  title            text,
  speakers         jsonb not null default '[]'::jsonb,   -- [ { "name": "Lord X" } ] in the order uploaded (alphabetical until the Today's List orders them)
  advisory_minutes int check (advisory_minutes is null or (advisory_minutes between 1 and 60)),
  uploaded_by      text,
  uploaded_at      timestamptz not null default now(),
  primary key (list_date, title_key)
);
create table if not exists public.group_actuals (
  list_date    date not null,
  bill_id      int  not null,
  stage_id     int  not null,
  group_number text not null,
  started_at   text not null check (started_at ~ '^[0-2][0-9]:[0-5][0-9]$'),   -- London clock time, HH:MM
  set_by       text,
  set_at       timestamptz not null default now(),
  primary key (list_date, bill_id, stage_id, group_number)
);
alter table public.debate_speakers enable row level security;
alter table public.group_actuals enable row level security;
revoke all on public.debate_speakers from anon, authenticated;
revoke all on public.group_actuals from anon, authenticated;
