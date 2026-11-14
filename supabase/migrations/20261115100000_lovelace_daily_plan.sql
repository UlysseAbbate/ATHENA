-- LOVELACE restructure: the Daily Plan, the Volunteer's Zone, and the social media tracker.
--
-- day_plan_entries: one row for each thing planned on a day, under an area and a section (like the Issues Tracker in LIBBY, each with a time, a place, a link and notes):
--   Mayor's Activity (mayor) and GLA Activity (gla): Field Campaign (field), Media (media), Membership Engagement (membership), Other Activities (other)
--   Internal Campaign (internal): Membership Engagement (membership), Donor Events (donor), Staff Activities (staff), Other (other)
--   Governance and Legal (governance): one section (governance)
-- Who sees what (in the database, not the page):
--   dayplan_full      read and change everything                          core team, executive
--   dayplan_volunteer read the Volunteer's Zone only: Mayor's and GLA Activity and Internal Campaign > Membership Engagement; never Governance and Legal
create table if not exists public.day_plan_entries (
  id         uuid primary key default gen_random_uuid(),
  plan_date  date not null,
  area       text not null check (area in ('mayor', 'gla', 'internal', 'governance')),
  section    text not null,
  title      text not null check (char_length(title) between 1 and 400),
  starts     text,                       -- when, as written: "10:00", "all day"
  place      text,
  link       text,
  detail     text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (
    (area in ('mayor', 'gla') and section in ('field', 'media', 'membership', 'other')) or
    (area = 'internal' and section in ('membership', 'donor', 'staff', 'other')) or
    (area = 'governance' and section = 'governance')
  )
);
create index if not exists day_plan_entries_date_idx on public.day_plan_entries (plan_date);

alter table public.day_plan_entries enable row level security;
create policy dpe_read on public.day_plan_entries for select to authenticated using (
  (select public.can('dayplan_full', 'read')) or
  ((select public.can('dayplan_volunteer', 'read')) and (area in ('mayor', 'gla') or (area = 'internal' and section = 'membership'))));
create policy dpe_insert on public.day_plan_entries for insert to authenticated with check ((select public.can('dayplan_full', 'write')));
create policy dpe_update on public.day_plan_entries for update to authenticated using ((select public.can('dayplan_full', 'write'))) with check ((select public.can('dayplan_full', 'write')));
create policy dpe_delete on public.day_plan_entries for delete to authenticated using ((select public.can('dayplan_full', 'write')));

drop trigger if exists day_plan_entries_touch on public.day_plan_entries;
create trigger day_plan_entries_touch before update on public.day_plan_entries for each row execute function public.touch();
drop trigger if exists day_plan_entries_audit on public.day_plan_entries;
create trigger day_plan_entries_audit after insert or update or delete on public.day_plan_entries for each row execute function public.audit();

insert into public.role_permissions (role, resource, can_read, can_write) values
  ('core_team', 'dayplan_full', true, true), ('executive', 'dayplan_full', true, true),
  ('core_team', 'dayplan_volunteer', true, true), ('executive', 'dayplan_volunteer', true, false), ('local_party_chair', 'dayplan_volunteer', true, false),
  ('candidate', 'dayplan_volunteer', true, false), ('support_team', 'dayplan_volunteer', true, false), ('member', 'dayplan_volunteer', true, false)
on conflict (role, resource) do nothing;

-- The old plan's entries, mapped across (the old tables are left as they are, as a backup):
--   Action Days, Other Events -> Mayor's Activity > Field Campaign;  Media Activity -> Mayor's Activity > Media;  Main News -> Mayor's Activity > Other Activities;
--   Governance -> Governance and Legal.  (The empty rows, such as the constituency sections and the news sections, have no entries to move.)
insert into public.day_plan_entries (plan_date, area, section, title, created_by, created_at, updated_at)
select e.plan_date,
       case c.name when 'Governance' then 'governance' else 'mayor' end,
       case c.name when 'Action Days' then 'field' when 'Other Events' then 'field' when 'Media Activity' then 'media' when 'Governance' then 'governance' else 'other' end,
       left(e.content, 400), e.created_by, e.updated_at, e.updated_at
from public.plan_entries e join public.plan_categories c on c.id = e.category_id
where c.name in ('Action Days', 'Other Events', 'Media Activity', 'Main News', 'Governance')
  and not exists (select 1 from public.day_plan_entries d where d.plan_date = e.plan_date and d.title = left(e.content, 400));

-- Social media tracker: a post is kept once per address, and accounts may be on a few more platforms.
create unique index if not exists social_posts_url_idx on public.social_posts (url);   -- (posts without an address are never the same post)
alter table public.social_accounts drop constraint if exists social_accounts_platform_check;
alter table public.social_accounts add constraint social_accounts_platform_check
  check (platform in ('Instagram', 'Facebook', 'Twitter', 'BlueSky', 'Substack', 'TikTok', 'LinkedIn', 'YouTube', 'Threads', 'Mastodon', 'Other'));
