-- 1. A signed-in person can claim a shared access code (for example the LIBBY beta code) on their own account: the code's level is
--    added to their account, never lowering a level they already have, and never an admin-only level. Called only by the server
--    (/api/claim-code), which checks who is asking and slows down guessing.
create or replace function public.claim_access_code(p_user uuid, p_code text) returns table (program text, level text)
language plpgsql security definer set search_path = '' as $$
declare c public.access_codes; r_new int; r_old int;
begin
  select * into c from public.access_codes x
  where x.revoked_at is null and (x.expires_at is null or x.expires_at > now()) and (x.max_uses is null or x.uses < x.max_uses)
    and x.code_hash = extensions.crypt(p_code, x.code_hash)
  limit 1;
  if c.id is null then return; end if;
  select l.rank into r_new from public.program_levels l where l.program = c.program and l.level = c.level and not l.admin_only;
  if r_new is null then return; end if;     -- a code can never give an admin-only level
  update public.access_codes set uses = uses + 1 where access_codes.id = c.id;
  select l.rank into r_old from public.access_grants g join public.program_levels l on l.program = g.program and l.level = g.level
   where g.user_id = p_user and g.program = c.program;
  if r_old is null then
    insert into public.access_grants (user_id, program, level, expires_at)
    values (p_user, c.program, c.level, (c.expires_at at time zone 'Europe/London')::date);
  elsif r_new > r_old then
    update public.access_grants g set level = c.level where g.user_id = p_user and g.program = c.program;
  end if;
  return query select c.program, c.level;
end $$;
revoke all on function public.claim_access_code(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_access_code(uuid, text) to service_role;

-- 2. New accounts waiting for access: the accounts that have signed up and been given nothing yet. The Access page lists them (admin only)
--    so the admin can choose each one's program and level. Shared-code accounts and the admin are not "waiting".
create or replace function public.pending_accounts() returns table (user_id uuid, email text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select u.id, u.email::text, u.created_at from auth.users u
  where public.is_admin()
    and u.email not like '%@codes.invalid'
    and not public.is_admin_user(u.id)
    and not exists (select 1 from public.access_grants g where g.user_id = u.id)
    and not exists (select 1 from public.profiles p where p.id = u.id and p.role is not null)
  order by u.created_at desc
$$;
revoke all on function public.pending_accounts() from public, anon;
grant execute on function public.pending_accounts() to authenticated;
