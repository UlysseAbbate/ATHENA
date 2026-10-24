create table public.ulysse_read (
  item_id text primary key,
  read_at timestamptz not null default now()
);
alter table public.ulysse_read enable row level security;
create policy ulysse_read_r on public.ulysse_read for select to authenticated using (public.is_admin());
create policy ulysse_read_i on public.ulysse_read for insert to authenticated with check (public.is_admin());
create policy ulysse_read_u on public.ulysse_read for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy ulysse_read_d on public.ulysse_read for delete to authenticated using (public.is_admin());
