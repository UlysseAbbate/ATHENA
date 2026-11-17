-- LOVELACE: (1) Parliamentary Activity gets its own area on the Daily Plan, (2) volunteers see the whole week, with different sections on other days than today,
-- (3) volunteers can read Communications (social and policies), (4) London Politics gets Policy reports and London media.

-- 1. Parliamentary Activity: Commons Business (Chamber + Westminster Hall), Lords Chamber (Chamber + Grand Committee), Committees.
alter table public.day_plan_entries drop constraint if exists day_plan_entries_area_check;
alter table public.day_plan_entries drop constraint if exists day_plan_entries_check;
alter table public.day_plan_entries add constraint day_plan_entries_area_check check (area in ('mayor', 'gla', 'internal', 'governance', 'london', 'parliament'));
alter table public.day_plan_entries add constraint day_plan_entries_check check (
  (area in ('mayor', 'gla') and section in ('field', 'media', 'membership', 'other')) or
  (area = 'internal' and section in ('membership', 'donor', 'staff', 'other')) or
  (area = 'governance' and section = 'governance') or
  (area = 'london' and section in ('data', 'political', 'events')) or
  (area = 'parliament' and section in ('commons', 'lords', 'committees')));
-- the What's On events the collector had put under London Politics > Political Events move across
update public.day_plan_entries set area = 'parliament',
  section = case when title like 'Commons Chamber:%' or title like 'Commons Westminster Hall:%' then 'commons'
                 when title like 'Lords Chamber:%' or title like 'Lords Grand Committee:%' then 'lords' else 'committees' end
where auto_key like 'whatson:%' and area = 'london';

-- 2. Volunteers see the week (Monday to Sunday, London time). Today: Mayor's and GLA Activity (all sections) and Internal Campaign > Membership Engagement and Other.
--    Another day: Mayor's and GLA Activity > Field Campaign and Membership Engagement, and Internal Campaign > Membership Engagement. Never Governance and Legal, London Politics or Parliamentary Activity.
drop policy if exists dpe_read on public.day_plan_entries;
create policy dpe_read on public.day_plan_entries for select to authenticated using (
  (select public.can('dayplan_full', 'read')) or
  ((select public.can('dayplan_volunteer', 'read'))
    and plan_date between date_trunc('week', now() at time zone 'Europe/London')::date and date_trunc('week', now() at time zone 'Europe/London')::date + 6
    and (
      (plan_date = (now() at time zone 'Europe/London')::date
        and (area in ('mayor', 'gla') or (area = 'internal' and section in ('membership', 'other'))))
      or
      (plan_date <> (now() at time zone 'Europe/London')::date
        and ((area in ('mayor', 'gla') and section in ('field', 'membership')) or (area = 'internal' and section = 'membership'))))));

-- 3 and 4. Permissions: volunteers (the Member role) can read the Communications page's trackers and policies, and London Politics' reports and media.
insert into public.role_permissions (role, resource, can_read, can_write)
select r, res, true, (r = 'core_team' and res in ('london_reports', 'london_media'))
from unnest(array['core_team', 'executive', 'local_party_chair', 'candidate', 'support_team', 'member']::public.app_role[]) as r, unnest(array['london_reports', 'london_media']) as res
on conflict (role, resource) do nothing;
insert into public.role_permissions (role, resource, can_read, can_write) values ('member', 'social', true, false), ('member', 'policies', true, false)
on conflict (role, resource) do update set can_read = true;

-- London Politics > Policy reports and London media: filled by the collector (the same open feeds and pages as LUCIEN), read by everyone with LOVELACE access.
create table if not exists public.london_feed (
  id         text primary key,
  kind       text not null check (kind in ('report', 'media')),
  source     text not null,
  title      text not null,
  url        text not null,
  published  timestamptz,
  first_seen timestamptz not null default now(),
  summary    text,
  tags       text[] not null default '{}',
  search     tsvector generated always as (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(source, ''))) stored
);
create index if not exists london_feed_kind_idx on public.london_feed (kind, published desc nulls last);
create index if not exists london_feed_search_idx on public.london_feed using gin (search);
alter table public.london_feed enable row level security;
create policy london_feed_read on public.london_feed for select to authenticated
  using (((kind = 'report') and (select public.can('london_reports', 'read'))) or ((kind = 'media') and (select public.can('london_media', 'read'))));
-- no insert / update / delete policies: only the collector (the service role, through the ingest function) writes

-- the core team keeps its right to see and change these like everything else in LOVELACE
create or replace function public.guard_core_permissions() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'core_team' and old.resource in ('dayplan_full', 'dayplan_volunteer', 'budget', 'volunteers_all', 'volunteers_add', 'stakeholders_all', 'stakeholders_add',
       'policies', 'social', 'coverage', 'visits', 'help_offer', 'help_inbox', 'mayor_todo', 'london_reports', 'london_media')
     and (tg_op = 'DELETE' or not new.can_read or not new.can_write) then
    raise exception 'The core team always keeps the right to see, edit and delete this.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.guard_core_permissions() from public, anon, authenticated;
