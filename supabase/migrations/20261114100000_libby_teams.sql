-- LIBBY teams: Staff bring people (staff or parliamentarians, by the email of their account) together so that they can share certain things.
-- For now that is one thing: members of a team see in full the Wallace Room and Room 391 bookings that other members of the team made.
-- A team never changes anyone's access level: it is a separate list, read only for the specific shared things, never for levels.
create table if not exists public.libby_teams (
  id         bigserial primary key,
  name       text not null check (char_length(name) between 1 and 60),
  created_by text,
  created_at timestamptz not null default now()
);
create unique index if not exists libby_teams_name_idx on public.libby_teams (lower(name));
create table if not exists public.libby_team_members (
  team_id  bigint not null references public.libby_teams(id) on delete cascade,
  email    text not null check (email = lower(email)),
  added_by text,
  added_at timestamptz not null default now(),
  primary key (team_id, email)
);
create index if not exists libby_team_members_email_idx on public.libby_team_members (email);
alter table public.libby_teams enable row level security;
alter table public.libby_team_members enable row level security;
revoke all on public.libby_teams, public.libby_team_members from anon, authenticated;
revoke all on sequence public.libby_teams_id_seq from anon, authenticated;
