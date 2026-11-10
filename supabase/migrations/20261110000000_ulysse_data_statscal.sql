-- The Stats calendar (LUCIEN) is stored as a fourth blob in ulysse_data, next to feed, polls and health.
alter table public.ulysse_data drop constraint if exists ulysse_data_name_check;
alter table public.ulysse_data add constraint ulysse_data_name_check check (name in ('feed', 'polls', 'health', 'statscal'));
