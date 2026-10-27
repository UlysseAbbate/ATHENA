-- Amendment buttons: Voting, Content, Not Content (replacing Voting issue, Priority issue, One to watch).
-- No flags had been set when this was written; any left over from the old set are removed.
delete from public.amendment_flags where flag not in ('voting');
alter table public.amendment_flags drop constraint if exists amendment_flags_flag_check;
alter table public.amendment_flags add constraint amendment_flags_flag_check check (flag in ('voting', 'content', 'notcontent'));
