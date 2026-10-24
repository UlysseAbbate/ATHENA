-- Athena master plan, phase 2: one access model for every program.
--   programs / program_levels  what exists and what levels each offers
--   access_grants              one row per person per program: level, optional manager tier, optional end date
--   access_codes               shared single-password access (hash only), created by the admin or a program manager
-- Additive: the Mall keeps reading profiles.role (Lovelace grants mirror it, one way) and the existing front end works unchanged.
-- Lucien (today's Ulysse) opens to anyone with an active Lucien grant, in addition to the existing role_permissions switch.
-- LIBBY's levels live here ready for phase 4; nothing reads them yet.

------------------------------------------------------------------ what exists
create table public.programs (
  id text primary key,
  name text not null,
  sort int not null default 0
);
insert into public.programs values ('lovelace', 'Lovelace', 1), ('lucien', 'Lucien', 2), ('libby', 'LIBBY', 3);

-- rank: higher = more access. admin_only levels can only be given by the admin (never by a manager or a code).
create table public.program_levels (
  program text not null references public.programs(id) on delete cascade,
  level text not null,
  label text not null,
  rank int not null,
  admin_only boolean not null default false,
  primary key (program, level)
);
insert into public.program_levels (program, level, label, rank, admin_only) values
  ('lovelace', 'member',            'Member',            1, false),
  ('lovelace', 'support_team',      'Support team',      2, false),
  ('lovelace', 'candidate',         'Candidate',         3, false),
  ('lovelace', 'local_party_chair', 'Local party chair', 4, false),
  ('lovelace', 'executive',         'Executive',         5, false),
  ('lovelace', 'core_team',         'Core team',         6, false),
  ('lucien',   'access',            'Access',            1, false),
  ('libby',    'peers',             'Peer',              1, false),
  ('libby',    'whips',             'Whip',              2, false),
  ('libby',    'spokesperson',      'Spokesperson',      2, false),
  ('libby',    'leader',            'Leader''s office',  2, false),
  ('libby',    'staff',             'Staff',             3, false),
  ('libby',    'admin',             'Admin',             4, true);

------------------------------------------------------------------ grants
create table public.access_grants (
  user_id uuid not null references auth.users(id) on delete cascade,
  program text not null,
  level text not null,
  is_manager boolean not null default false,   -- program manager: manages this program's people (admin gives and removes this)
  grant_ceiling int,                           -- managers only: highest level rank they may grant or put on a code; null = any level that is not admin_only
  expires_at date,                             -- last day of access (London time); null = no end
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, program),
  foreign key (program, level) references public.program_levels(program, level),
  check (grant_ceiling is null or is_manager)
);
create index access_grants_program_idx on public.access_grants (program);
alter table public.access_grants enable row level security;

------------------------------------------------------------------ who is who
create or replace function public.is_admin_user(uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins a where a.user_id = uid)
$$;

-- my grant for a program, if it exists and has not ended
create or replace function public.my_grant(p text) returns public.access_grants
language sql stable security definer set search_path = '' as $$
  select g.* from public.access_grants g
  where g.user_id = (select auth.uid()) and g.program = p
    and (g.expires_at is null or g.expires_at >= (now() at time zone 'Europe/London')::date)
$$;

create or replace function public.has_program(p text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin() or (public.my_grant(p)).user_id is not null
$$;

create or replace function public.is_program_manager(p text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin() or coalesce((public.my_grant(p)).is_manager, false)
$$;

-- the person's level in a program (the admin has each program's top level)
create or replace function public.program_level(p text) returns text
language sql stable security definer set search_path = '' as $$
  select case when public.is_admin()
         then (select l.level from public.program_levels l where l.program = p order by l.rank desc, l.level limit 1)
         else (public.my_grant(p)).level end
$$;

-- the highest rank this person may grant in a program: the admin any, a manager up to their ceiling, others none
create or replace function public.grant_limit(p text) returns int
language sql stable security definer set search_path = '' as $$
  select case when public.is_admin() then 2147483647
              when (public.my_grant(p)).is_manager then coalesce((public.my_grant(p)).grant_ceiling, 2147483647)
              else 0 end
$$;

revoke all on function public.is_admin_user(uuid), public.my_grant(text), public.has_program(text), public.is_program_manager(text),
  public.program_level(text), public.grant_limit(text) from public, anon;
grant execute on function public.has_program(text), public.is_program_manager(text), public.program_level(text), public.grant_limit(text) to authenticated;

-- Lucien opens to anyone with an active Lucien grant, on top of the existing Ulysse permission
create or replace function public.can(res text, act text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin()
    or (res = 'ulysse' and act = 'read' and (public.my_grant('lucien')).user_id is not null)
    or coalesce((select case act when 'read' then rp.can_read when 'write' then rp.can_write end
                 from public.role_permissions rp
                 where rp.role = public.my_role() and rp.resource = res), false)
$$;

------------------------------------------------------------------ the rules (in the database, not the page)
create or replace function public.guard_grant_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  prog text := coalesce(new.program, old.program);
  tgt uuid := coalesce(new.user_id, old.user_id);
  mirror boolean := pg_trigger_depth() > 1 and coalesce(current_setting('athena.mirror', true), '') = '1';
  lim int;
  r int;
begin
  if tg_op = 'UPDATE' then
    if new.user_id <> old.user_id or new.program <> old.program then raise exception 'A grant cannot be moved to another person or program'; end if;
  end if;
  if mirror then   -- the one-way copy of the Mall's roles (profiles) into Lovelace grants, already checked by the profile rules
    if tg_op <> 'DELETE' then new.updated_at := now(); return new; end if;
    return old;
  end if;
  if prog = 'lovelace' and actor is not null then
    raise exception 'Lovelace access is still managed in The Mall, Team & access';
  end if;
  if actor is null or public.is_admin() then   -- SQL editor, service role, or the admin
    if tg_op = 'INSERT' and new.granted_by is null then new.granted_by := actor; end if;
    if tg_op <> 'DELETE' then new.updated_at := now(); return new; end if;
    return old;
  end if;
  if not public.is_program_manager(prog) then raise exception 'You do not manage %', prog; end if;
  if tgt = actor then raise exception 'You cannot change your own access'; end if;
  if public.is_admin_user(tgt) then raise exception 'Only the admin can change the admin''s access'; end if;
  if (tg_op <> 'INSERT' and old.is_manager) or (tg_op <> 'DELETE' and new.is_manager)
     or (tg_op = 'UPDATE' and new.grant_ceiling is distinct from old.grant_ceiling) then
    raise exception 'Only the admin can make or remove a program manager';
  end if;
  lim := public.grant_limit(prog);
  if tg_op <> 'INSERT' then
    select l.rank into r from public.program_levels l where l.program = prog and l.level = old.level;
    if r > lim or exists (select 1 from public.program_levels l where l.program = prog and l.level = old.level and l.admin_only) then
      raise exception 'That person''s level is above what you may change';
    end if;
  end if;
  if tg_op <> 'DELETE' then
    select l.rank into r from public.program_levels l where l.program = prog and l.level = new.level;
    if r > lim or exists (select 1 from public.program_levels l where l.program = prog and l.level = new.level and l.admin_only) then
      raise exception 'You may not give that level';
    end if;
    if tg_op = 'INSERT' then new.granted_by := actor; end if;
    new.updated_at := now();
    return new;
  end if;
  return old;
end $$;
revoke all on function public.guard_grant_change() from public, anon, authenticated;
create trigger access_grants_guard before insert or update or delete on public.access_grants
  for each row execute function public.guard_grant_change();

create policy grants_read on public.access_grants for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()) or (select public.is_program_manager(program)));
create policy grants_i on public.access_grants for insert to authenticated
  with check ((select public.is_admin()) or (select public.is_program_manager(program)));
create policy grants_u on public.access_grants for update to authenticated
  using ((select public.is_admin()) or (select public.is_program_manager(program)))
  with check ((select public.is_admin()) or (select public.is_program_manager(program)));
create policy grants_d on public.access_grants for delete to authenticated
  using ((select public.is_admin()) or (select public.is_program_manager(program)));
revoke all on public.access_grants from anon, authenticated;
grant select, delete on public.access_grants to authenticated;
grant insert (user_id, program, level, is_manager, grant_ceiling, expires_at) on public.access_grants to authenticated;
grant update (level, is_manager, grant_ceiling, expires_at) on public.access_grants to authenticated;

alter table public.programs enable row level security;
alter table public.program_levels enable row level security;
create policy programs_read on public.programs for select to authenticated using (true);
create policy levels_read on public.program_levels for select to authenticated using (true);
revoke all on public.programs, public.program_levels from anon, authenticated;
grant select on public.programs, public.program_levels to authenticated;

------------------------------------------------------------------ Lovelace grants follow the Mall's roles (one way: profiles -> grants)
create or replace function public.mirror_profile_to_grant() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('athena.mirror', '1', true);
  if new.role is null then
    delete from public.access_grants where user_id = new.id and program = 'lovelace';
  else
    insert into public.access_grants (user_id, program, level, expires_at, is_manager)
    values (new.id, 'lovelace', new.role::text, new.access_until, new.role = 'core_team')
    on conflict (user_id, program) do update
      set level = excluded.level, expires_at = excluded.expires_at, is_manager = excluded.is_manager;
  end if;
  perform set_config('athena.mirror', '', true);
  return null;
end $$;
revoke all on function public.mirror_profile_to_grant() from public, anon, authenticated;
create trigger profiles_mirror after insert or update of role, access_until on public.profiles
  for each row execute function public.mirror_profile_to_grant();

-- today's Mall roles become Lovelace grants; the core team keeps managing Team & access, now as program managers
insert into public.access_grants (user_id, program, level, expires_at, is_manager)
select p.id, 'lovelace', p.role::text, p.access_until, p.role = 'core_team' from public.profiles p where p.role is not null
on conflict do nothing;

------------------------------------------------------------------ people, for the people who manage them
create or replace function public.program_people(p text) returns table
  (user_id uuid, email text, full_name text, level text, is_manager boolean, grant_ceiling int, expires_at date, granted_at timestamptz, last_sign_in_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select g.user_id, u.email::text, coalesce(pr.full_name, ''), g.level, g.is_manager, g.grant_ceiling, g.expires_at, g.granted_at, u.last_sign_in_at
  from public.access_grants g
  join auth.users u on u.id = g.user_id
  left join public.profiles pr on pr.id = g.user_id
  where g.program = p and public.is_program_manager(p)
  order by u.email
$$;

-- every account and what it has (admin only): the master People list
create or replace function public.all_people() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x ->> 'email'), '[]'::jsonb) from (
    select jsonb_build_object('user_id', u.id, 'email', u.email, 'full_name', coalesce(pr.full_name, ''), 'last_sign_in_at', u.last_sign_in_at,
      'admin', public.is_admin_user(u.id),
      'grants', coalesce((select jsonb_agg(jsonb_build_object('program', g.program, 'level', g.level, 'is_manager', g.is_manager,
                          'grant_ceiling', g.grant_ceiling, 'expires_at', g.expires_at) order by g.program)
                          from public.access_grants g where g.user_id = u.id), '[]'::jsonb)) as x
    from auth.users u left join public.profiles pr on pr.id = u.id
    where public.is_admin()) s
$$;

-- give (or change) a person's level by email; the table rules above decide whether the caller may
create or replace function public.grant_access(p_email text, p_program text, p_level text, p_expires date default null) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid;
begin
  if not public.is_program_manager(p_program) then raise exception 'You do not manage %', p_program; end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then raise exception 'No account has that email yet. Ask them to create one first.'; end if;
  insert into public.access_grants (user_id, program, level, expires_at) values (uid, p_program, p_level, p_expires)
  on conflict (user_id, program) do update set level = excluded.level, expires_at = excluded.expires_at;
end $$;

-- admin only: make or unmake a program manager, with the highest level they may hand out
create or replace function public.set_manager(p_user uuid, p_program text, p_on boolean, p_ceiling int default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Only the admin can make or remove a program manager'; end if;
  update public.access_grants set is_manager = p_on, grant_ceiling = case when p_on then p_ceiling end
  where user_id = p_user and program = p_program;
  if not found then raise exception 'Give them a level in % first', p_program; end if;
end $$;

revoke all on function public.program_people(text), public.all_people(), public.grant_access(text, text, text, date), public.set_manager(uuid, text, boolean, int) from public, anon;
grant execute on function public.program_people(text), public.all_people(), public.grant_access(text, text, text, date), public.set_manager(uuid, text, boolean, int) to authenticated;

------------------------------------------------------------------ shared access codes (the single-password route)
create table public.access_codes (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  program text not null,
  level text not null,
  code_hash text not null,                 -- bcrypt; the code itself is never stored
  expires_at timestamptz,
  max_uses int check (max_uses is null or max_uses > 0),
  uses int not null default 0,
  revoked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (program, level) references public.program_levels(program, level)
);
alter table public.access_codes enable row level security;
revoke all on public.access_codes from anon, authenticated;
grant select (id, label, program, level, expires_at, max_uses, uses, revoked_at, created_by, created_at) on public.access_codes to authenticated;
create policy codes_read on public.access_codes for select to authenticated
  using ((select public.is_admin()) or (select public.is_program_manager(program)));

-- Make a code. Pass your own simple password, or leave it empty for a random one. Returned once; only its hash is kept.
create or replace function public.create_access_code(p_label text, p_program text, p_level text, p_expires timestamptz default null,
                                                     p_max_uses int default null, p_code text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare code text; r int; adm boolean;
begin
  if not public.is_program_manager(p_program) then raise exception 'You do not manage %', p_program; end if;
  select l.rank, l.admin_only into r, adm from public.program_levels l where l.program = p_program and l.level = p_level;
  if r is null then raise exception 'Unknown level'; end if;
  if adm then raise exception 'A code cannot give that level'; end if;
  if r > public.grant_limit(p_program) then raise exception 'You may not make a code for that level'; end if;
  if coalesce(trim(p_label), '') = '' then raise exception 'Give the code a label'; end if;
  code := coalesce(nullif(p_code, ''), (select string_agg(substr(encode(extensions.gen_random_bytes(2), 'hex'), 1, 4), '-') from generate_series(1, 5)));
  if length(code) < 8 then raise exception 'A code needs at least 8 characters'; end if;
  if exists (select 1 from public.access_codes c where c.revoked_at is null and (c.expires_at is null or c.expires_at > now())
             and c.code_hash = extensions.crypt(code, c.code_hash)) then
    raise exception 'That code is already in use. Choose another.';
  end if;
  insert into public.access_codes (label, program, level, code_hash, expires_at, max_uses, created_by)
  values (trim(p_label), p_program, p_level, extensions.crypt(code, extensions.gen_salt('bf', 10)), p_expires, p_max_uses, (select auth.uid()));
  return code;
end $$;

create or replace function public.revoke_access_code(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare prog text;
begin
  select program into prog from public.access_codes where id = p_id;
  if prog is null then raise exception 'No such code'; end if;
  if not public.is_program_manager(prog) then raise exception 'You do not manage %', prog; end if;
  update public.access_codes set revoked_at = now() where id = p_id and revoked_at is null;
end $$;

-- Used only by the sign-in function (service role): checks a typed code and counts the use. Returns nothing when it is wrong.
create or replace function public.redeem_access_code(p_code text) returns table (id uuid, label text, program text, level text)
language plpgsql security definer set search_path = '' as $$
declare c public.access_codes;
begin
  select * into c from public.access_codes x
  where x.revoked_at is null and (x.expires_at is null or x.expires_at > now()) and (x.max_uses is null or x.uses < x.max_uses)
    and x.code_hash = extensions.crypt(p_code, x.code_hash)
  limit 1;
  if c.id is null then return; end if;
  update public.access_codes set uses = uses + 1 where access_codes.id = c.id;
  return query select c.id, c.label, c.program, c.level;
end $$;

revoke all on function public.create_access_code(text, text, text, timestamptz, int, text), public.revoke_access_code(uuid), public.redeem_access_code(text) from public, anon, authenticated;
grant execute on function public.create_access_code(text, text, text, timestamptz, int, text), public.revoke_access_code(uuid) to authenticated;
grant execute on function public.redeem_access_code(text) to service_role;

------------------------------------------------------------------ audit: grants and codes (who, when, which fields; never the values)
create or replace function public.audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  ch text[];
begin
  if tg_op = 'UPDATE' then
    select array_agg(k order by k) into ch from jsonb_object_keys(r) k
    where r -> k is distinct from o -> k and k not in ('updated_at','updated_by','uses');
    if ch is null then return null; end if;
  end if;
  insert into public.audit_log (user_id, user_email, table_name, row_id, label, action, changed)
  values ((select auth.uid()), (select p.email from public.profiles p where p.id = (select auth.uid())), tg_table_name,
          coalesce(r ->> 'id', (r ->> 'user_id') || '/' || (r ->> 'program'), (r ->> 'role') || '/' || (r ->> 'resource')),
          left(coalesce(r ->> 'name', r ->> 'headline', r ->> 'title', r ->> 'item', r ->> 'policy', r ->> 'local_party',
                        r ->> 'organisation', r ->> 'email', r ->> 'content',
                        (select u.email || ' · ' || (r ->> 'program') || ' · ' || (r ->> 'level') from auth.users u where u.id::text = r ->> 'user_id'),
                        r ->> 'label', (r ->> 'role') || ' · ' || (r ->> 'resource')), 90),
          lower(tg_op), ch);
  return null;
end $$;
revoke all on function public.audit() from public, anon, authenticated;
create trigger access_grants_audit after insert or update or delete on public.access_grants for each row execute function public.audit();
create trigger access_codes_audit after insert or update or delete on public.access_codes for each row execute function public.audit();

------------------------------------------------------------------ what the front end learns at sign-in (old keys unchanged)
create or replace function public.my_access() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'profile', (select to_jsonb(p) from public.profiles p where p.id = (select auth.uid())),
    'role', public.my_role(),
    'admin', public.is_admin(),
    'perms', coalesce((
      select jsonb_object_agg(r.resource, jsonb_build_object(
               'r', public.is_admin() or coalesce(rp.can_read, false),
               'w', public.is_admin() or coalesce(rp.can_write, false)))
      from (select distinct resource from public.role_permissions) r
      left join public.role_permissions rp on rp.resource = r.resource and rp.role = public.my_role()), '{}'::jsonb),
    'programs', coalesce((
      select jsonb_object_agg(pr.id, jsonb_build_object('level', public.program_level(pr.id), 'manager', public.is_program_manager(pr.id),
                                                              'limit', public.grant_limit(pr.id)))
      from public.programs pr where public.has_program(pr.id) or (pr.id = 'lucien' and public.can('ulysse', 'read'))), '{}'::jsonb))
$$;
revoke all on function public.my_access() from public, anon;
grant execute on function public.my_access() to authenticated;
