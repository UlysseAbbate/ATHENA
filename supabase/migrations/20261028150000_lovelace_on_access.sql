-- LOVELACE joins LUCIEN and LIBBY on the Access page: its levels are now given there, like the others (levels, end dates, program managers,
-- shared codes). The grant (access_grants) is the source; LOVELACE's own screens still read the person's role from profiles, so a grant
-- change is copied across to the profile (grants -> profiles, below). The old copy the other way (profiles -> grants) stays for edits made
-- straight in the database, and the two never chase each other (the flags athena.mirror and athena.sync stop that).

-- 1. LOVELACE grants are handled by the same rules as the other programs' (no special "managed in The Mall" refusal)
do $$
declare def text;
begin
  def := pg_get_functiondef('public.guard_grant_change()'::regprocedure);
  def := replace(def, E'  if prog = ''lovelace'' and actor is not null then\n    raise exception ''Lovelace access is still managed in The Mall, Team & access'';\n  end if;\n', '');
  if def like '%still managed in The Mall%' then raise exception 'guard_grant_change was not changed'; end if;
  execute def;

  def := pg_get_functiondef('public.create_access_code(text, text, text, timestamptz, int, text)'::regprocedure);
  def := replace(def, E'  if p_program = ''lovelace'' then raise exception ''Lovelace codes arrive when Lovelace moves onto these access levels''; end if;\n', '');
  if def like '%Lovelace codes arrive%' then raise exception 'create_access_code was not changed'; end if;
  execute def;

  -- a role set because a grant changed has already been checked by the grant rules: the profile rules step aside
  def := pg_get_functiondef('public.guard_profile_update()'::regprocedure);
  def := replace(def, E'begin\n  if (select auth.uid()) is null', E'begin\n  if coalesce(current_setting(''athena.sync'', true), '''') = ''1'' then return new; end if;\n  if (select auth.uid()) is null');
  if def not like '%athena.sync%' then raise exception 'guard_profile_update was not changed'; end if;
  execute def;
end $$;

-- 2. profile -> grant (as before), but it no longer undoes a manager switch, and it stands aside when the change came from a grant
create or replace function public.mirror_profile_to_grant() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('athena.sync', true), '') = '1' then return null; end if;
  perform set_config('athena.mirror', '1', true);
  if new.role is null then
    delete from public.access_grants where user_id = new.id and program = 'lovelace';
  else
    insert into public.access_grants (user_id, program, level, expires_at, is_manager)
    values (new.id, 'lovelace', new.role::text, new.access_until, new.role = 'core_team')
    on conflict (user_id, program) do update set level = excluded.level, expires_at = excluded.expires_at;
  end if;
  perform set_config('athena.mirror', '', true);
  return null;
end $$;

-- 3. grant -> profile: a LOVELACE grant (given, changed or removed on the Access page) sets the person's role and end date
create or replace function public.sync_lovelace_grant_to_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (case when tg_op = 'DELETE' then old.program else new.program end) <> 'lovelace' then return null; end if;
  if coalesce(current_setting('athena.mirror', true), '') = '1' then return null; end if;   -- the change came from the profile
  perform set_config('athena.sync', '1', true);
  if tg_op = 'DELETE' then
    update public.profiles set role = null, access_until = null where id = old.user_id;
  else
    update public.profiles set role = new.level::public.app_role, access_until = new.expires_at where id = new.user_id;
  end if;
  perform set_config('athena.sync', '', true);
  return null;
end $$;
revoke all on function public.sync_lovelace_grant_to_profile() from public, anon, authenticated;
create trigger access_grants_to_profile after insert or update or delete on public.access_grants
  for each row execute function public.sync_lovelace_grant_to_profile();

-- 4. the admin's list of everyone now also says when each account was made
create or replace function public.all_people() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x ->> 'email'), '[]'::jsonb) from (
    select jsonb_build_object('user_id', u.id, 'email', u.email, 'full_name', coalesce(pr.full_name, ''), 'last_sign_in_at', u.last_sign_in_at,
      'created_at', u.created_at, 'admin', public.is_admin_user(u.id),
      'grants', coalesce((select jsonb_agg(jsonb_build_object('program', g.program, 'level', g.level, 'is_manager', g.is_manager,
                          'grant_ceiling', g.grant_ceiling, 'expires_at', g.expires_at) order by g.program)
                          from public.access_grants g where g.user_id = u.id), '[]'::jsonb)) as x
    from auth.users u left join public.profiles pr on pr.id = u.id
    where public.is_admin() and not public.is_code_identity(u.id)) s
$$;
