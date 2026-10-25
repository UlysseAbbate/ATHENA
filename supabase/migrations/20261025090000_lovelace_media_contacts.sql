-- Lovelace tidy-up: one People/contacts list (volunteers + stakeholders), local party visits placed on the Campaign plan by date,
-- and the tracked social accounts completed. The old volunteers / stakeholders tables are kept as they are (an archive);
-- nothing is deleted.

------------------------------------------------------------------ contacts: volunteers and stakeholders in one list
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('volunteer', 'stakeholder')),
  name text not null,
  organisation text,              -- volunteers: Lib Dems
  sector text,                    -- volunteers: Lib Dems
  email text,
  phone text,
  owner text,                     -- the point of contact on our side
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create index contacts_kind_idx on public.contacts (kind);
alter table public.contacts enable row level security;
revoke all on public.contacts from anon;
grant select, insert, update, delete on public.contacts to authenticated;

-- Who may see and change what is exactly what it was for the two old lists: the "full list" permissions of each kind see every row of that
-- kind; anyone allowed to add can see and edit their own entries.
create policy contacts_read on public.contacts for select to authenticated using (
  created_by = (select auth.uid())
  or (kind = 'volunteer' and (select public.can('volunteers_all', 'read')))
  or (kind = 'stakeholder' and (select public.can('stakeholders_all', 'read'))));
create policy contacts_insert on public.contacts for insert to authenticated with check (
  created_by = (select auth.uid())
  and ((kind = 'volunteer' and (select public.can('volunteers_add', 'write')))
    or (kind = 'stakeholder' and (select public.can('stakeholders_add', 'write')))));
create policy contacts_update on public.contacts for update to authenticated
  using (created_by = (select auth.uid())
    or (kind = 'volunteer' and (select public.can('volunteers_all', 'write')))
    or (kind = 'stakeholder' and (select public.can('stakeholders_all', 'write'))))
  with check (created_by = (select auth.uid())
    or (kind = 'volunteer' and (select public.can('volunteers_all', 'write')))
    or (kind = 'stakeholder' and (select public.can('stakeholders_all', 'write'))));
create policy contacts_delete on public.contacts for delete to authenticated using (
  created_by = (select auth.uid())
  or (kind = 'volunteer' and (select public.can('volunteers_all', 'write')))
  or (kind = 'stakeholder' and (select public.can('stakeholders_all', 'write'))));

create trigger contacts_touch before update on public.contacts for each row execute function public.touch();
create trigger contacts_audit after insert or update or delete on public.contacts for each row execute function public.audit();

insert into public.contacts (id, kind, name, organisation, sector, email, phone, owner, notes, created_by, created_at, updated_at)
select v.id, 'volunteer', v.name, 'Lib Dems', 'Lib Dems', v.email, v.phone, nullif(v.asked_by, ''),
       nullif(concat_ws(E'\n', 'Role: ' || v.role_wanted, 'Availability: ' || v.availability,
                        case when v.accepted is true then 'Accepted: yes' when v.accepted is false then 'Accepted: no' end, v.notes), ''),
       v.created_by, v.created_at, v.updated_at
from public.volunteers v;

insert into public.contacts (id, kind, name, organisation, sector, email, phone, owner, notes, created_by, created_at, updated_at)
select s.id, 'stakeholder', s.name, s.organisation, s.sector, s.email, s.phone, coalesce(nullif(s.owner, ''), nullif(s.point_person_name, '')),
       nullif(concat_ws(E'\n', s.notes,
         case when s.point_person_name is not null and s.point_person_name is distinct from coalesce(nullif(s.owner, ''), '')
              then 'Their point person: ' || s.point_person_name || coalesce(' (' || s.point_person_contact || ')', '') end), ''),
       s.created_by, s.created_at, s.updated_at
from public.stakeholders s;

------------------------------------------------------------------ local party visits: put them on the Campaign plan by date
-- The visits sheet kept the date as free text ("4th November"). Read it into the date column, and give each dated visit a line on the
-- plan's "Local Party Visits" row (if that day does not already mention the party). Visits with no date stay on the sheet, which now
-- sits under the Campaign plan.
create temp table visit_dates (vid uuid, local_party text, request text, d date);
insert into visit_dates
select v.id, v.local_party, v.request, make_date(2026, case lower(m[2]) when 'january' then 1 when 'february' then 2 when 'march' then 3 when 'april' then 4 when 'may' then 5
         when 'june' then 6 when 'july' then 7 when 'august' then 8 when 'september' then 9 when 'october' then 10 when 'november' then 11 else 12 end, m[1]::int)
from public.local_party_visits v,
     lateral (select regexp_matches(v.happening, '(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December)', 'gi') as m) x
where v.visit_date is null and v.happening is not null;

-- a second date for the same visit becomes its own row on the sheet
insert into public.local_party_visits (local_party, request, taken_by, actioning, happening, visit_date, contact_name, contact_phone, notes)
select v.local_party, v.request, v.taken_by, v.actioning, v.happening, d.d, v.contact_name, v.contact_phone, v.notes
from public.local_party_visits v
join (select vid, d, row_number() over (partition by vid order by d) as n from visit_dates) d on d.vid = v.id and d.n > 1;

update public.local_party_visits v set visit_date = d.d
from (select vid, d, row_number() over (partition by vid order by d) as n from visit_dates) d
where v.visit_date is null and d.vid = v.id and d.n = 1;

insert into public.plan_entries (plan_date, category_id, content)
select vd.d, (select id from public.plan_categories where name = 'Local Party Visits'),
       vd.local_party || coalesce(': ' || nullif(vd.request, ''), '')
from visit_dates vd
where not exists (select 1 from public.plan_entries e
                  where e.plan_date = vd.d and e.category_id = (select id from public.plan_categories where name = 'Local Party Visits')
                    and e.content ilike '%' || split_part(replace(vd.local_party, ' and ', ' '), ' ', 1) || '%');

drop table visit_dates;

------------------------------------------------------------------ tracked social accounts: Hina Bokhari AM, and the handles we know
insert into public.social_accounts (organisation, platform)
select 'Hina Bokhari AM', p from unnest(array['Instagram', 'Facebook', 'Twitter', 'BlueSky', 'Substack', 'TikTok', 'LinkedIn']) p
on conflict (organisation, platform) do nothing;
update public.social_accounts set handle = 'sarahjolney1', url = 'https://twitter.com/sarahjolney1'
  where organisation = 'Sarah Olney MP' and platform = 'Twitter' and handle is null;
update public.social_accounts set handle = 'saraholneyld', url = 'https://www.facebook.com/saraholneyld'
  where organisation = 'Sarah Olney MP' and platform = 'Facebook' and handle is null;

-- the collector (service role) reads these to know which accounts to follow
create index if not exists media_coverage_date_idx on public.media_coverage (covered_on desc);
