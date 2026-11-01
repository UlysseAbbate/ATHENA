-- Access codes are kept, so they can be listed, copied, changed and tracked (they used to be shown once and then forgotten).
-- The code itself is stored next to its hash in a column that no ordinary read can see: it comes back only through program_codes(),
-- and only to the program's managers (the administrator for every program). Codes made before this change were never kept and say so.

alter table public.access_codes add column if not exists code_text text;   -- not in the column grant above: invisible to table reads

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
  insert into public.access_codes (label, program, level, code_hash, code_text, expires_at, max_uses, created_by)
  values (trim(p_label), p_program, p_level, extensions.crypt(code, extensions.gen_salt('bf', 10)), code, p_expires, p_max_uses, (select auth.uid()));
  return code;
end $$;

-- a program's codes, with the code itself, for its managers
create or replace function public.program_codes(p text) returns table
  (id uuid, label text, level text, code text, expires_at timestamptz, max_uses int, uses int, revoked_at timestamptz, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.id, c.label, c.level, c.code_text, c.expires_at, c.max_uses, c.uses, c.revoked_at, c.created_at
  from public.access_codes c where c.program = p and public.is_program_manager(p)
  order by c.created_at desc
$$;

-- change what a code gives (the hidden account everyone using it signs in as follows)
create or replace function public.set_code_level(p_id uuid, p_level text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.access_codes; r int; adm boolean;
begin
  select * into c from public.access_codes where id = p_id;
  if c.id is null then raise exception 'No such code'; end if;
  if not public.is_program_manager(c.program) then raise exception 'You do not manage %', c.program; end if;
  select l.rank, l.admin_only into r, adm from public.program_levels l where l.program = c.program and l.level = p_level;
  if r is null then raise exception 'Unknown level'; end if;
  if adm then raise exception 'A code cannot give that level'; end if;
  if r > public.grant_limit(c.program) then raise exception 'You may not give that level'; end if;
  update public.access_codes set level = p_level where id = p_id;
  if c.identity_user_id is not null then
    update public.access_grants set level = p_level where user_id = c.identity_user_id and program = c.program;
  end if;
end $$;

-- change when a code ends (null = never), or switch a code back on
create or replace function public.set_code_expiry(p_id uuid, p_expires timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare prog text;
begin
  select program into prog from public.access_codes where id = p_id;
  if prog is null then raise exception 'No such code'; end if;
  if not public.is_program_manager(prog) then raise exception 'You do not manage %', prog; end if;
  update public.access_codes set expires_at = p_expires where id = p_id;
end $$;

create or replace function public.restore_access_code(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare prog text;
begin
  select program into prog from public.access_codes where id = p_id;
  if prog is null then raise exception 'No such code'; end if;
  if not public.is_program_manager(prog) then raise exception 'You do not manage %', prog; end if;
  update public.access_codes set revoked_at = null where id = p_id;
end $$;

revoke all on function public.program_codes(text), public.set_code_level(uuid, text), public.set_code_expiry(uuid, timestamptz), public.restore_access_code(uuid) from public, anon;
grant execute on function public.program_codes(text), public.set_code_level(uuid, text), public.set_code_expiry(uuid, timestamptz), public.restore_access_code(uuid) to authenticated;
