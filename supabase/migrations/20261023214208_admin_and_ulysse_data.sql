create table public.admins (email text primary key);
alter table public.admins enable row level security;          -- no policies: unreachable from the API
insert into public.admins values ('ulysse.abbate@gmail.com');

-- true only for a signed-in user whose CONFIRMED auth email is in admins
create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users u join public.admins a on lower(a.email) = lower(u.email)
    where u.id = (select auth.uid()) and u.email_confirmed_at is not null)
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- admin can do everything in the Mall
create or replace function public.can(res text, act text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin() or coalesce((select case act when 'read' then rp.can_read when 'write' then rp.can_write end
                   from public.role_permissions rp
                   where rp.role = public.my_role() and rp.resource = res), false)
$$;

-- nobody but the admin may change the admin's own profile/role
drop policy profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles for update to authenticated
  using (public.can('users','write') and (public.is_admin() or not exists (
          select 1 from public.admins a where lower(a.email) = lower(profiles.email))))
  with check (public.can('users','write') and (public.is_admin() or not exists (
          select 1 from public.admins a where lower(a.email) = lower(profiles.email))));
-- the admin can always see everyone
drop policy profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.can('users','read'));

-- Ulysse data: admin-only
create table public.ulysse_data (
  name text primary key check (name in ('feed','polls','health')),
  body jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.ulysse_data enable row level security;
create policy ulysse_admin_read on public.ulysse_data for select to authenticated using (public.is_admin());
-- no insert/update/delete policies: only the ingest function (service role) writes
