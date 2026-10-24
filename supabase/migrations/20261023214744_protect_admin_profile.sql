create function public.is_admin_email(e text) returns boolean
language sql stable security definer set search_path = '' as
$$ select exists (select 1 from public.admins a where lower(a.email) = lower(e)) $$;
revoke all on function public.is_admin_email(text) from public, anon;
grant execute on function public.is_admin_email(text) to authenticated;

drop policy profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles for update to authenticated
  using (public.can('users','write') and (public.is_admin() or not public.is_admin_email(email)))
  with check (public.can('users','write') and (public.is_admin() or not public.is_admin_email(email)));
