-- LOVELACE: the Volunteer's Zone shows today only; "Help the Campaign" suggestions and offers; the "London Politics" area of the Daily Plan;
-- and the core team can always edit and delete everything in LOVELACE.

-- 1. Volunteers see today only (London date). Whoever has the full plan still sees every day.
drop policy if exists dpe_read on public.day_plan_entries;
create policy dpe_read on public.day_plan_entries for select to authenticated using (
  (select public.can('dayplan_full', 'read')) or
  ((select public.can('dayplan_volunteer', 'read'))
    and plan_date = ((now() at time zone 'Europe/London'))::date
    and (area in ('mayor', 'gla') or (area = 'internal' and section = 'membership'))));

-- 2. London Politics: GLA / London Data (filled in automatically from the same collector as LUCIEN's Stats calendar, GLA and London data drops only),
--    Political Events, London Events. Not shown to volunteers.
alter table public.day_plan_entries drop constraint if exists day_plan_entries_area_check;
alter table public.day_plan_entries drop constraint if exists day_plan_entries_check;
alter table public.day_plan_entries add constraint day_plan_entries_area_check check (area in ('mayor', 'gla', 'internal', 'governance', 'london'));
alter table public.day_plan_entries add constraint day_plan_entries_check check (
  (area in ('mayor', 'gla') and section in ('field', 'media', 'membership', 'other')) or
  (area = 'internal' and section in ('membership', 'donor', 'staff', 'other')) or
  (area = 'governance' and section = 'governance') or
  (area = 'london' and section in ('data', 'political', 'events')));
alter table public.day_plan_entries add column if not exists auto_key text;   -- set on the entries the collector adds (one per data drop); null for everything typed in
create unique index if not exists day_plan_entries_auto_idx on public.day_plan_entries (auto_key);

-- 3. Help the Campaign: anyone with LOVELACE access can send a suggestion or an offer; the campaign team (core team, executive) sees the list, on the People page.
create table if not exists public.campaign_suggestions (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(name) between 1 and 120),
  contact       text check (contact is null or char_length(contact) <= 200),
  ok_to_contact boolean not null default false,
  kind          text not null check (kind in ('venue', 'contact', 'policy', 'digital_filming', 'digital_editing', 'events')),
  details       text check (details is null or char_length(details) <= 1500),
  status        text not null default 'new' check (status in ('new', 'in progress', 'done')),
  notes         text,                                   -- the campaign team's own notes
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid
);
alter table public.campaign_suggestions enable row level security;
create policy cs_insert on public.campaign_suggestions for insert to authenticated with check ((select public.can('help_offer', 'write')) and created_by = (select auth.uid()));
create policy cs_read on public.campaign_suggestions for select to authenticated using ((select public.can('help_inbox', 'read')));
create policy cs_update on public.campaign_suggestions for update to authenticated using ((select public.can('help_inbox', 'write'))) with check ((select public.can('help_inbox', 'write')));
create policy cs_delete on public.campaign_suggestions for delete to authenticated using ((select public.can('help_inbox', 'write')));
drop trigger if exists campaign_suggestions_touch on public.campaign_suggestions;
create trigger campaign_suggestions_touch before update on public.campaign_suggestions for each row execute function public.touch();
drop trigger if exists campaign_suggestions_audit on public.campaign_suggestions;
create trigger campaign_suggestions_audit after insert or update or delete on public.campaign_suggestions for each row execute function public.audit();

insert into public.role_permissions (role, resource, can_read, can_write) values
  ('core_team', 'help_inbox', true, true), ('executive', 'help_inbox', true, true),
  ('core_team', 'help_offer', true, true), ('executive', 'help_offer', true, true), ('local_party_chair', 'help_offer', true, true),
  ('candidate', 'help_offer', true, true), ('support_team', 'help_offer', true, true), ('member', 'help_offer', true, true)
on conflict (role, resource) do nothing;

-- 4. The core team can always edit and delete everything in LOVELACE: nobody can switch these rights off (the permissions grid shows them locked).
insert into public.role_permissions (role, resource, can_read, can_write)
select 'core_team', r, true, true from unnest(array['dayplan_full', 'dayplan_volunteer', 'budget', 'volunteers_all', 'volunteers_add', 'stakeholders_all', 'stakeholders_add',
  'policies', 'social', 'coverage', 'visits', 'help_offer', 'help_inbox']) r
on conflict (role, resource) do update set can_read = true, can_write = true;
create or replace function public.guard_core_permissions() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'core_team' and old.resource in ('dayplan_full', 'dayplan_volunteer', 'budget', 'volunteers_all', 'volunteers_add', 'stakeholders_all', 'stakeholders_add',
       'policies', 'social', 'coverage', 'visits', 'help_offer', 'help_inbox')
     and (tg_op = 'DELETE' or not new.can_read or not new.can_write) then
    raise exception 'The core team always keeps the right to see, edit and delete this.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.guard_core_permissions() from public, anon, authenticated;
drop trigger if exists role_permissions_core_guard on public.role_permissions;
create trigger role_permissions_core_guard before update or delete on public.role_permissions for each row execute function public.guard_core_permissions();
