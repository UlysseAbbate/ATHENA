-- The Roles list now covers Lib Dem MPs as well as peers: a person added by hand says which House they are in.
alter table public.people_roles add column if not exists house text not null default 'lords';
alter table public.people_roles drop constraint if exists people_roles_house_check;
alter table public.people_roles add constraint people_roles_house_check check (house in ('lords', 'commons'));
