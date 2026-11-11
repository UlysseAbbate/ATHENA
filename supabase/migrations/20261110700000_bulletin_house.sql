-- The Whips' Office Bulletin now comes in two: one for the Lords and one for the Commons. Messages already there stay in the Lords one.
alter table public.bulletin_messages add column if not exists house text not null default 'lords';
alter table public.bulletin_messages drop constraint if exists bulletin_messages_house_check;
alter table public.bulletin_messages add constraint bulletin_messages_house_check check (house in ('lords', 'commons'));
