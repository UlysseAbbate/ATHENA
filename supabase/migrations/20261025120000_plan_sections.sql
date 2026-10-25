-- Campaign plan: seven sections (Main news + Solney story; Constituency Activity, one editable section per GLA constituency;
-- Parliamentary Activity; Media; Campaigning; London News and Events; Internal Actions). Every existing entry is moved into its new
-- section before the old sections are removed (entries are never deleted). Old entry wording is kept; the three kinds of London news
-- get a short label so single-day events, ongoing events and reports can still be told apart.

alter table public.plan_categories add column constituency boolean not null default false;

-- who may edit the constituency sections: local party chairs and above (the grid on Team & access can change this)
insert into public.role_permissions (role, resource, can_read, can_write)
select role, 'plan_constituency', can_read, role in ('executive', 'core_team', 'local_party_chair')
from public.role_permissions where resource = 'plan_shared'
on conflict do nothing;

-- 1. Main news + Solney story
update public.plan_categories set name = 'Main News + Solney Story', sort = 1, shared = false where id = 1;
update public.plan_entries set category_id = 1 where category_id = 2;

-- 2. Constituency Activity: one section per GLA constituency (created below, once the old sections are gone); the old
-- "Constituency Milestones" row becomes the section for anything that spans several
update public.plan_categories set name = 'Constituency Activity: All constituencies', sort = 25, shared = true, constituency = true where id = 4;

-- 3. Parliamentary Activity (DBIST, Commons, Lords)
update public.plan_categories set name = 'Parliamentary Activity (DBIST, Commons, Lords)', sort = 30, shared = false where id = 5;
update public.plan_entries set category_id = 5 where category_id in (16, 17);

-- 4. Media (broadcast, print, digital, Substack)
update public.plan_categories set name = 'Media (broadcast, print, digital, Substack)', sort = 40, shared = false where id = 6;
update public.plan_entries set category_id = 6 where category_id = 8;

-- 5. Campaigning (campaign actions, visits)
update public.plan_categories set name = 'Campaigning (campaign actions, visits)', sort = 50, shared = true where id = 9;
update public.plan_entries set category_id = 9 where category_id in (7, 11);

-- 6. London News and Events
update public.plan_categories set name = 'London News and Events', sort = 60, shared = false where id = 12;
update public.plan_entries set content = 'Single-day event: ' || content, category_id = 12 where category_id = 13;
update public.plan_entries set content = 'Ongoing: ' || content, category_id = 12 where category_id = 14;
update public.plan_entries set content = 'Stats, data or report: ' || content, category_id = 12 where category_id = 15;

-- 7. Internal Actions (governance, meetings, party actions)
update public.plan_categories set name = 'Internal Actions (governance, meetings, party actions)', sort = 70, shared = false where id = 10;
update public.plan_entries set category_id = 10 where category_id = 3;

delete from public.plan_categories where id in (2, 3, 7, 8, 11, 13, 14, 15, 16, 17);

insert into public.plan_categories (name, sort, shared, constituency)
select 'Constituency Activity: ' || n, 10 + i, true, true
from unnest(array['Barnet and Camden', 'Bexley and Bromley', 'Brent and Harrow', 'City and East', 'Croydon and Sutton', 'Ealing and Hillingdon',
                  'Enfield and Haringey', 'Greenwich and Lewisham', 'Havering and Redbridge', 'Lambeth and Southwark', 'Merton and Wandsworth',
                  'North East', 'South West', 'West Central', 'All constituencies']) with ordinality as t(n, i)
on conflict (name) do nothing;

-- the plan policies: the constituency sections can also be read and edited with the plan_constituency permission
drop policy plan_cat_read on public.plan_categories;
create policy plan_cat_read on public.plan_categories for select to authenticated using (
  public.can('plan_full', 'read') or (shared and public.can('plan_shared', 'read')) or (constituency and public.can('plan_constituency', 'read')));

drop policy plan_read on public.plan_entries;
drop policy plan_insert on public.plan_entries;
drop policy plan_update on public.plan_entries;
drop policy plan_delete on public.plan_entries;
create policy plan_read on public.plan_entries for select to authenticated using (
  public.can('plan_full', 'read')
  or (public.can('plan_shared', 'read') and exists (select 1 from public.plan_categories c where c.id = category_id and c.shared))
  or (public.can('plan_constituency', 'read') and exists (select 1 from public.plan_categories c where c.id = category_id and c.constituency)));
create policy plan_insert on public.plan_entries for insert to authenticated with check (
  public.can('plan_full', 'write')
  or (public.can('plan_shared', 'write') and exists (select 1 from public.plan_categories c where c.id = category_id and c.shared))
  or (public.can('plan_constituency', 'write') and exists (select 1 from public.plan_categories c where c.id = category_id and c.constituency)));
create policy plan_update on public.plan_entries for update to authenticated using (
  public.can('plan_full', 'write')
  or (public.can('plan_shared', 'write') and exists (select 1 from public.plan_categories c where c.id = category_id and c.shared))
  or (public.can('plan_constituency', 'write') and exists (select 1 from public.plan_categories c where c.id = category_id and c.constituency)))
  with check (
  public.can('plan_full', 'write')
  or (public.can('plan_shared', 'write') and exists (select 1 from public.plan_categories c where c.id = category_id and c.shared))
  or (public.can('plan_constituency', 'write') and exists (select 1 from public.plan_categories c where c.id = category_id and c.constituency)));
create policy plan_delete on public.plan_entries for delete to authenticated using (
  public.can('plan_full', 'write')
  or (public.can('plan_shared', 'write') and exists (select 1 from public.plan_categories c where c.id = category_id and c.shared))
  or (public.can('plan_constituency', 'write') and exists (select 1 from public.plan_categories c where c.id = category_id and c.constituency)));
