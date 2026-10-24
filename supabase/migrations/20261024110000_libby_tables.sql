-- LIBBY's tables, brought into the Athena project (master plan, phase 4). Copied from LIBBY's supabase/schema.sql, which is safe to re-run.
-- Row-level security is on with no policies and the public API roles have no rights: only the server (service-role key) reads or writes.
-- Existing LIBBY data is copied across separately (see docs/MASTER-PLAN.md, phase 4); this file creates the empty tables.

-- LIBBY (Liberal Intelligence for Business, Briefings and Year-round policy): the COMPLETE, CURRENT database. Paste the whole file into Supabase -> SQL Editor -> Run.
-- Every statement is safe to re-run: anything that already exists is left as it is, so running this on the live
-- database changes nothing that is already there and only adds what is missing.
--
-- When you add a table for a new feature, add it to the bottom of this file AND put the same SQL in
-- supabase/migrations/ as a numbered file (see the README there). The checker (scripts/check-site.mjs) fails if the
-- code uses a table that this file does not create.

-- =====================================================================  Policy library
create table if not exists policy_documents (
  id           bigserial primary key,
  source_url   text unique not null,
  title        text not null,
  doc_type     text not null check (doc_type in ('motion', 'policy_paper')),
  conference   text,
  date_label   text,
  date_passed  date,
  status       text,
  portfolios   text[] default '{}',
  content_hash text,
  full_text    text,
  fetched_at   timestamptz default now()
);
create table if not exists policy_chunks (
  id           bigserial primary key,
  document_id  bigint not null references policy_documents(id) on delete cascade,
  chunk_index  int not null,
  content      text not null,
  tsv          tsvector generated always as (to_tsvector('english', content)) stored,
  unique (document_id, chunk_index)
);
create index if not exists policy_chunks_tsv_idx on policy_chunks using gin (tsv);
create index if not exists policy_documents_portfolios_idx on policy_documents using gin (portfolios);

-- Best-matching extract per document. The column is called extract_text because "extract" is reserved in Postgres.
drop function if exists search_policy(text, text, int);
create function search_policy(q text, portfolio text default null, max_results int default 40)
returns table (
  document_id bigint, title text, doc_type text, date_label text, date_passed date,
  status text, source_url text, portfolios text[], extract_text text, rank real
)
language sql stable set search_path = public, pg_catalog as $$
  with query as (select websearch_to_tsquery('english', q) as tsq),
  hits as (
    select c.document_id, c.content, ts_rank_cd(c.tsv, query.tsq) as rank,
           row_number() over (partition by c.document_id order by ts_rank_cd(c.tsv, query.tsq) desc) as rn
    from policy_chunks c, query
    where c.tsv @@ query.tsq
  )
  select d.id, d.title, d.doc_type, d.date_label, d.date_passed, d.status, d.source_url, d.portfolios,
         ts_headline('english', h.content, (select tsq from query),
           'StartSel=<mark>, StopSel=</mark>, MaxWords=45, MinWords=20, MaxFragments=2, FragmentDelimiter=" ... "') as extract_text,
         h.rank
  from hits h
  join policy_documents d on d.id = h.document_id
  where h.rn = 1 and (portfolio is null or portfolio = any(d.portfolios))
  order by h.rank desc, d.date_passed desc nulls last
  limit max_results;
$$;

-- =====================================================================  Whips' Office business and the What's On calendar
create table if not exists whips_business (
  id            bigserial primary key,
  source        text not null check (source in ('fb', 'todays_list')),
  business_date date not null,
  section       text,
  position      int not null,
  text          text not null,
  kind          text,
  dept          text,
  fetched_at    timestamptz default now()
);
create index if not exists whips_business_date_idx on whips_business (source, business_date);

create table if not exists whips_snapshots (
  id          bigserial primary key,
  source      text not null,
  source_url  text,
  raw_text    text,
  fetched_at  timestamptz default now()
);

create table if not exists whatson_events (
  id          bigserial primary key,
  event_date  date not null,
  house       text not null default 'Lords',
  section     text,
  position    int,
  start_time  text,
  category    text,
  title       text,
  members     jsonb,
  event_url   text,                       -- the item's page on whatson.parliament.uk (used for the Speakers link)
  speakers    boolean not null default false
);
alter table whatson_events add column if not exists event_url text;
alter table whatson_events add column if not exists speakers boolean not null default false;
create index if not exists whatson_events_date_idx on whatson_events (house, event_date);

-- =====================================================================  Claude output cache
create table if not exists oq_suggestions (
  key        text primary key,
  payload    jsonb not null,
  created_at timestamptz default now()
);

-- =====================================================================  Bills: advisers, comments, groupings, grid text
create table if not exists bill_advisers (
  bill_id    int primary key,
  advisers   text,
  updated_by text,
  updated_at timestamptz default now()
);

create table if not exists amendment_comments (
  id           bigserial primary key,
  bill_id      int not null,
  stage_id     int not null,
  amendment_id int not null,
  body         text not null,
  author       text,
  created_at   timestamptz default now()
);
create index if not exists amendment_comments_stage_idx on amendment_comments (bill_id, stage_id);

create table if not exists groupings (
  id           bigserial primary key,
  bill_id      int not null,
  stage_id     int not null,
  stage_name   text,
  day          int not null,
  sitting_date date,
  title        text,
  groups       jsonb not null default '[]'::jsonb,
  themes       jsonb,
  updated_by   text,
  updated_at   timestamptz default now(),
  unique (bill_id, stage_id, day)
);

create table if not exists amendment_descriptions (
  amendment_id int primary key,
  stage_id     int,
  description  text not null,
  created_at   timestamptz default now()
);

-- =====================================================================  Comms
create table if not exists comms_posts (
  platform   text primary key,
  body       text,
  post_url   text,
  posted_at  date,
  updated_by text,
  updated_at timestamptz default now()
);

-- =====================================================================  Voting Data
create table if not exists lords_divisions (
  division_id   int primary key,
  number        int,
  division_date date not null,
  title         text not null,
  content       int not null default 0,
  not_content   int not null default 0,
  parties       jsonb not null default '{}'::jsonb,
  fetched_at    timestamptz default now()
);
create index if not exists lords_divisions_date_idx on lords_divisions (division_date);

-- =====================================================================  Whips page: duty rota, availability, hymn sheets
create table if not exists duty_whips (
  duty_date  date not null,
  slot       smallint not null check (slot in (1, 2)),
  whip       text not null,
  updated_by text,
  updated_at timestamptz default now(),
  primary key (duty_date, slot)
);

create table if not exists whip_availability (
  duty_date  date not null,
  whip       text not null,
  status     text not null check (status in ('green', 'amber', 'red')),
  updated_at timestamptz default now(),
  primary key (duty_date, whip)
);
create index if not exists whip_availability_date_idx on whip_availability (duty_date);

create table if not exists hymn_sheets (
  id           bigserial primary key,
  title        text not null,
  bill_id      int,
  bill_title   text,
  stage        text,
  day_number   int,
  sitting_date date,
  file_name    text not null,
  content_type text,
  size_bytes   int,
  uploaded_by  text,
  uploaded_at  timestamptz default now()
);
create table if not exists hymn_sheet_files (
  sheet_id bigint primary key references hymn_sheets(id) on delete cascade,
  data     text not null
);

-- =====================================================================  Home page bulletin
create table if not exists bulletin_messages (
  id         bigserial primary key,
  heading    text,
  body       text not null,
  position   int not null default 0,
  updated_by text,
  updated_at timestamptz default now()
);

-- =====================================================================  Wallace Room
-- Times are London local times stored as plain timestamps (no time zone), so daylight saving never shifts a booking.

-- A recurring booking: the rule that made a set of bookings (every week, every weekday, ...).
create table if not exists room_series (
  id         bigserial primary key,
  peer       text not null,
  note       text,
  rule       jsonb not null,          -- { from, until, every, days, start, end }
  created_at timestamptz default now()
);

-- Every booking is one row, including each date of a recurring booking.
-- The exclusion constraint makes the DATABASE refuse overlapping bookings, so two people clicking at the same moment
-- cannot both get the room. (Back-to-back bookings are fine: the range includes its start and not its end.)
create table if not exists room_bookings (
  id         bigserial primary key,
  series_id  bigint references room_series(id) on delete set null,
  peer       text not null,
  note       text,
  start_at   timestamp not null,
  end_at     timestamp not null,
  created_at timestamptz default now(),
  check (end_at > start_at),
  exclude using gist (tsrange(start_at, end_at) with &&)
);
create index if not exists room_bookings_start_idx on room_bookings (start_at);
create index if not exists room_bookings_series_idx on room_bookings (series_id);

-- =====================================================================  Saved copies of slow Parliament lookups
-- Renewed by .github/workflows/refresh-data.yml (see lib/schedule.js for the times) and by the "Refresh now" button.
create table if not exists api_snapshots (
  key        text primary key,
  payload    jsonb not null,
  updated_at timestamptz not null default now()
);

-- =====================================================================  Bill page: stakeholders and amendment flags
-- Stakeholders: who we have heard from on a Bill and what they said (a briefing typed in, an uploaded file, or both).
-- The file is kept apart from the notes so that listing a Bill's stakeholders never loads files.
create table if not exists bill_stakeholders (
  id           bigserial primary key,
  bill_id      int not null,
  organisation text not null,
  contact_name text,
  contact      text,
  position     text,                    -- their position in a line or two
  briefing     text,                    -- the briefing, typed in
  file_name    text,
  content_type text,
  size_bytes   int,
  created_by   text,
  created_at   timestamptz default now(),
  updated_by   text,
  updated_at   timestamptz default now()
);
create index if not exists bill_stakeholders_bill_idx on bill_stakeholders (bill_id);

create table if not exists bill_stakeholder_files (
  stakeholder_id bigint primary key references bill_stakeholders(id) on delete cascade,
  data           text not null           -- the file, as base64 text
);

-- Amendment flags: voting issue (green), priority issue (orange), one to watch (red). An amendment can carry more than one.
create table if not exists amendment_flags (
  bill_id      int not null,
  stage_id     int not null,
  amendment_id int not null,
  flag         text not null check (flag in ('voting', 'priority', 'watch')),
  set_by       text,
  set_at       timestamptz default now(),
  primary key (bill_id, stage_id, amendment_id, flag)
);

-- =====================================================================  People and their roles
-- A directory of who is a Whip, Spokesperson and so on. A Liberal Democrat peer from the Members API has a row here only when
-- their role is not the default (Peer); people who are not on the API (staff) are added by hand and always have a row.
-- It decides who appears in the Whips pages (the duty rota and availability for whipping). It does not give anyone access:
-- that comes from the role and password chosen at sign-in (lib/access.js).
create table if not exists people_roles (
  name       text primary key,
  role       text not null check (role in ('peers', 'whips', 'spokesperson', 'leader', 'staff', 'admin')),
  updated_by text,
  updated_at timestamptz default now()
);

-- =====================================================================  Today's List (uploaded PDF) and site settings
-- One row per sitting day: the Government Whips' Office "Today's Lists" PDF read in the browser (data), the text it was read from
-- (raw_text, so a newer reader can read it again), and the advisers' changes for that day (settings: estimated times shown or hidden,
-- changed start times, the peers added to speak in each piece of business).
create table if not exists todays_lists (
  list_date   date primary key,
  data        jsonb not null,
  raw_text    text,
  settings    jsonb not null default '{}'::jsonb,
  uploaded_by text,
  uploaded_at timestamptz default now(),
  updated_by  text,
  updated_at  timestamptz default now()
);

-- Settings for the whole site, one row each (for now: "sitting_rules", the estimated lengths used for the start times).
create table if not exists site_settings (
  key        text primary key,
  value      jsonb not null,
  updated_by text,
  updated_at timestamptz default now()
);

-- =====================================================================  Sign-in throttling
-- Failed sign-ins (lib/throttle.js): a keyed hash of the address, never the address itself. Deleted after a day.
create table if not exists login_failures (
  id   bigint generated always as identity primary key,
  who  text not null,
  at   timestamptz not null default now()
);
create index if not exists login_failures_who_at_idx on login_failures (who, at desc);

-- =====================================================================  Security
-- Row Level Security on, with no public policies: only the server (service-role key, held as a Cloudflare secret
-- and a GitHub secret) can read or write.
alter table policy_documents       enable row level security;
alter table policy_chunks          enable row level security;
alter table whips_business         enable row level security;
alter table whips_snapshots        enable row level security;
alter table whatson_events         enable row level security;
alter table oq_suggestions         enable row level security;
alter table bill_advisers          enable row level security;
alter table amendment_comments     enable row level security;
alter table groupings              enable row level security;
alter table amendment_descriptions enable row level security;
alter table comms_posts            enable row level security;
alter table lords_divisions        enable row level security;
alter table duty_whips             enable row level security;
alter table whip_availability      enable row level security;
alter table hymn_sheets            enable row level security;
alter table hymn_sheet_files       enable row level security;
alter table bulletin_messages      enable row level security;
alter table room_series             enable row level security;
alter table room_bookings           enable row level security;
alter table api_snapshots           enable row level security;
alter table bill_stakeholders      enable row level security;
alter table bill_stakeholder_files enable row level security;
alter table amendment_flags        enable row level security;
alter table people_roles          enable row level security;
alter table todays_lists          enable row level security;
alter table site_settings         enable row level security;
alter table login_failures        enable row level security;

-- The browser never talks to the database: no rights at all for the public API roles (defence in depth behind RLS).
-- (Athena's own tables keep their grants: only LIBBY's tables are locked down here.)
do $$
declare t text; q text;
begin
  foreach t in array array['policy_documents', 'policy_chunks', 'whips_business', 'whips_snapshots', 'whatson_events', 'oq_suggestions', 'bill_advisers', 'amendment_comments', 'groupings', 'amendment_descriptions', 'comms_posts', 'lords_divisions', 'duty_whips', 'whip_availability', 'hymn_sheets', 'hymn_sheet_files', 'bulletin_messages', 'room_series', 'room_bookings', 'api_snapshots', 'bill_stakeholders', 'bill_stakeholder_files', 'amendment_flags', 'people_roles', 'todays_lists', 'site_settings', 'login_failures'] loop
    execute format('revoke all on public.%I from anon, authenticated', t);
    for q in select pg_get_serial_sequence('public.' || t, a.attname) from pg_attribute a
             where a.attrelid = ('public.' || t)::regclass and a.attnum > 0 and not a.attisdropped loop
      if q is not null then execute format('revoke all on sequence %s from anon, authenticated', q); end if;
    end loop;
  end loop;
end $$;
revoke execute on function search_policy(text, text, int) from public, anon, authenticated;

-- After LIBBY's existing rows are copied in with their own ids (scripts/libby/copy-data.mjs), the id counters must move past them.
create or replace function public.libby_reset_sequences() returns void
language plpgsql security definer set search_path = '' as $$
declare r record; s text; m bigint;
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r'
             and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'id' and not a.attisdropped) loop
    s := pg_get_serial_sequence('public.' || quote_ident(r.relname), 'id');
    if s is not null then
      execute format('select max(id) from public.%I', r.relname) into m;
      if m is not null then perform setval(s, m); end if;
    end if;
  end loop;
end $$;
revoke all on function public.libby_reset_sequences() from public, anon, authenticated;
grant execute on function public.libby_reset_sequences() to service_role;
