-- LOVELACE "This Week": the plan's sections are grouped under five headings, each with its own subsections.
--   Main News · Across London (Constituency Activity, Local Party Activity) · Campaigning (Mayoral Activity, Action Days, Other Events)
--   · Media (Parliamentary News, GLA News, Council News, Media Activity) · Internal Actions (Executive, Campaigns Committee, Governance, Membership, Candidates)
-- Every existing entry stays: old sections are renamed in place, and the one that goes (London News and Events) is moved into Other Events first.
-- The Media page gets two sections: Overall Media and Lib Dem Media (every row so far is Lib Dem Media), and a topic for the
-- news that "This Week" shows as highlights.

alter table public.plan_categories add column if not exists grp text;

update public.plan_categories set name = 'Main News', grp = 'Main News', sort = 1 where name = 'Main News + Solney Story';
update public.plan_categories set grp = 'Across London' where constituency;
update public.plan_categories set name = 'Parliamentary News', grp = 'Media', sort = 60 where name like 'Parliamentary Activity%';
update public.plan_categories set name = 'Media Activity', grp = 'Media', sort = 63 where name like 'Media (broadcast%';
update public.plan_categories set name = 'Action Days', grp = 'Campaigning', sort = 51 where name like 'Campaigning (%';
update public.plan_categories set name = 'Governance', grp = 'Internal Actions', sort = 72 where name like 'Internal Actions (%';

-- the new subsections. Local Party Activity is edited by local party chairs (like the constituency sections) and carries the visit requests;
-- the three Campaigning ones are shared with the roles that could see Campaigning before.
insert into public.plan_categories (name, grp, sort, shared, constituency) values
  ('Local Party Activity',  'Across London',    30, true,  true),
  ('Mayoral Activity',      'Campaigning',      50, true,  false),
  ('Other Events',          'Campaigning',      52, true,  false),
  ('GLA News',              'Media',            61, false, false),
  ('Council News',          'Media',            62, false, false),
  ('Executive',             'Internal Actions', 70, false, false),
  ('Campaigns Committee',   'Internal Actions', 71, false, false),
  ('Membership',            'Internal Actions', 73, false, false),
  ('Candidates',            'Internal Actions', 74, false, false)
on conflict (name) do nothing;

update public.plan_entries set category_id = (select id from public.plan_categories where name = 'Other Events')
  where category_id in (select id from public.plan_categories where name = 'London News and Events');
delete from public.plan_categories where name = 'London News and Events';

-- Media: Overall Media and Lib Dem Media, and the topic of a story
alter table public.media_coverage add column if not exists kind text not null default 'libdem' check (kind in ('overall', 'libdem'));
alter table public.media_coverage add column if not exists topic text check (topic in ('parliament', 'gla', 'council'));
