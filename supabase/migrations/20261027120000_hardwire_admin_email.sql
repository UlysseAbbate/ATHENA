-- The admin is hardwired: the one account whose confirmed email is ulysse.abbate@gmail.com. Nothing in a table decides it any more, so
-- no row can be added, changed or removed to make someone else the admin (the old public.admins table is kept only as a record).
create or replace function public.admin_email() returns text
language sql immutable parallel safe set search_path = '' as $$ select 'ulysse.abbate@gmail.com'::text $$;

create or replace function public.is_admin_user(uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from auth.users u
                 where u.id = uid and lower(u.email) = public.admin_email() and u.email_confirmed_at is not null)
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin_user((select auth.uid()))
$$;

-- "this profile row is the admin's" (used to stop anyone else editing it)
create or replace function public.is_admin_email(e text) returns boolean
language sql stable security definer set search_path = '' as $$ select lower(e) = public.admin_email() $$;

-- the profile guard asked the admins table; it now asks the hardwired email
do $$
declare def text;
begin
  def := pg_get_functiondef('public.guard_profile_update()'::regprocedure);
  def := replace(def, 'exists (select 1 from public.admins a where a.user_id = old.id or lower(a.email) = lower(old.email))', 'public.is_admin_email(old.email)');
  if def like '%public.admins%' then raise exception 'guard_profile_update still reads the admins table'; end if;
  execute def;
end $$;

revoke all on function public.admin_email() from public, anon;
grant execute on function public.admin_email() to authenticated, service_role;
