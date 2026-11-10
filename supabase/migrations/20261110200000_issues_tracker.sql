-- The Issues Tracker (Lib Dems 150): campaigns and long-standing issues, each in a portfolio, each with a running list of what has been done on it.
create table if not exists public.issues (
  id          bigserial primary key,
  portfolio   text not null,                 -- a portfolio code (lib/libby/portfolios-data.js)
  title       text not null,
  description text not null default '',
  status      text not null default 'open' check (status in ('open', 'closed')),
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists issues_portfolio_idx on public.issues (portfolio);

create table if not exists public.issue_actions (
  id              bigserial primary key,
  issue_id        bigint not null references public.issues(id) on delete cascade,
  what            text not null,             -- the thing that was done
  kind            text not null default 'other',
  done_on         date not null,
  url             text,                      -- Hansard or another system
  parliamentarian text,
  staff           text,                      -- the adviser or member of staff responsible
  notes           text not null default '',
  added_by        text,
  created_at      timestamptz not null default now()
);
create index if not exists issue_actions_issue_idx on public.issue_actions (issue_id, done_on);

alter table public.issues enable row level security;
alter table public.issue_actions enable row level security;
revoke all on public.issues, public.issue_actions from anon, authenticated;
revoke all on sequence public.issues_id_seq, public.issue_actions_id_seq from anon, authenticated;
