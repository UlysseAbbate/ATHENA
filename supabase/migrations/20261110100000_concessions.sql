-- The Concessionometer (Lib Dems 150): every amendment marked WIN, kept whether or not its Bill is still live.
-- A row is a snapshot taken when the amendment is marked WIN (so the Bill's title and portfolio stay even after the Bill has gone), plus the POLD Staff's notes on the concession.
create table if not exists public.concessions (
  bill_id       int  not null,
  stage_id      int  not null,
  amendment_id  int  not null,
  house         text not null default 'lords' check (house in ('lords', 'commons')),
  number        text,
  place         text,
  summary       text,
  url           text,
  bill_title    text,
  portfolio     text,            -- portfolio codes, comma separated (see lib/portfolios-data.js)
  notes         text not null default '',
  won_by        text,
  won_at        timestamptz not null default now(),
  updated_by    text,
  updated_at    timestamptz not null default now(),
  primary key (bill_id, stage_id, amendment_id)
);
alter table public.concessions enable row level security;
revoke all on public.concessions from anon, authenticated;

-- WIN is a fourth button on an amendment, next to Vote, C and NC
alter table public.amendment_flags drop constraint if exists amendment_flags_flag_check;
alter table public.amendment_flags add constraint amendment_flags_flag_check check (flag in ('voting', 'content', 'notcontent', 'win'));
