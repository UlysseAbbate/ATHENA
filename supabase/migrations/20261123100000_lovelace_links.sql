-- LOVELACE: the Links page (it replaces the Stakeholders tab): buttons to the team's shared documents, for the core team and above.
-- The addresses are kept in a table so the database, not the page, decides who may read them (permission 'links'): the core team reads and edits, and the administrator can give it to others.
create table if not exists public.links (
  id         uuid primary key default gen_random_uuid(),
  label      text not null check (char_length(label) between 1 and 120),
  url        text not null check (url ~ '^https://' and char_length(url) <= 2000),
  position   int  not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.links enable row level security;
create policy links_read   on public.links for select to authenticated using ((select public.can('links', 'read')));
create policy links_insert on public.links for insert to authenticated with check ((select public.can('links', 'write')));
create policy links_update on public.links for update to authenticated using ((select public.can('links', 'write'))) with check ((select public.can('links', 'write')));
create policy links_delete on public.links for delete to authenticated using ((select public.can('links', 'write')));
drop trigger if exists links_touch on public.links;
create trigger links_touch before update on public.links for each row execute function public.touch();
drop trigger if exists links_audit on public.links;
create trigger links_audit after insert or update or delete on public.links for each row execute function public.audit();

insert into public.role_permissions (role, resource, can_read, can_write)
select r, 'links', r = 'core_team', r = 'core_team'
from unnest(array['core_team', 'executive', 'local_party_chair', 'candidate', 'support_team', 'member']::public.app_role[]) as r
on conflict (role, resource) do nothing;

-- the core team keeps its right to see and change the Links like everything else in LOVELACE
create or replace function public.guard_core_permissions() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'core_team' and old.resource in ('dayplan_full', 'dayplan_volunteer', 'budget', 'volunteers_all', 'volunteers_add', 'stakeholders_all', 'stakeholders_add',
       'policies', 'social', 'coverage', 'visits', 'help_offer', 'help_inbox', 'mayor_todo', 'london_reports', 'london_media', 'links')
     and (tg_op = 'DELETE' or not new.can_read or not new.can_write) then
    raise exception 'The core team always keeps the right to see, edit and delete this.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.guard_core_permissions() from public, anon, authenticated;

insert into public.links (label, url, position)
select v.label, v.url, v.position from (values
  ('Stakeholders', 'https://docs.google.com/spreadsheets/d/1CelozKVMCXSYHujUpNcIH3CDKM-SmEbLRrU-YvnvyxA/edit?usp=sharing', 1),
  ('Policies', 'https://drive.google.com/drive/folders/1c7RNdUw1EtfUicmtKyER0iNK0MjzFbhk?usp=share_link', 2),
  ('Brand Guidelines', 'https://drive.google.com/file/d/1Eub9sSgq8OxLbbjAGWp-98pTpahtL49r/view?usp=share_link', 3),
  ('Digital Communications Guide', 'https://drive.google.com/file/d/1nF41GRzuZ-4hS7w_I0gF5M6MCeLWVHWL/view?usp=share_link', 4),
  ('Selection Organogram', 'https://docs.google.com/presentation/d/1jJN_Bfl3TqiTNoW2gGiN7xQKvI-zijTTeF2eSlUt6DM/edit?usp=sharing', 5),
  ('Campaigns Organogram', 'https://docs.google.com/presentation/d/1qOKZ5Fhe6-DE6AferTOtJr0NCO90huIxaDzI1a3pqi8/edit?usp=sharing', 6)
) as v(label, url, position)
where not exists (select 1 from public.links);
