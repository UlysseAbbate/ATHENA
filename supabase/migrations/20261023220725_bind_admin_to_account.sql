alter table public.admins add column user_id uuid references auth.users(id) on delete set null;
update public.admins a set user_id = (select u.id from auth.users u where lower(u.email) = lower(a.email));

-- admin = the account bound to an admin email. Email alone is NOT enough, because with
-- "Confirm email" switched off anyone can register any unused address.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.admins a
    where a.user_id is not null and a.user_id = (select auth.uid()))
$$;

-- the first account to register an unclaimed admin email claims it (only while user_id is null,
-- i.e. before you have ever signed up, or after your account was deleted)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name',''),
          (select 'core_team'::public.app_role from public.bootstrap_admins b where lower(b.email) = lower(new.email)));
  update public.admins set user_id = new.id where lower(email) = lower(new.email) and user_id is null;
  return new;
end $$;

-- is_admin_email now means "this profile row belongs to the bound admin account"
create or replace function public.is_admin_email(e text) returns boolean
language sql stable security definer set search_path = '' as
$$ select exists (select 1 from public.admins a where lower(a.email) = lower(e)) $$;
