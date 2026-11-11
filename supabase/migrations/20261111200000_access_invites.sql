-- Invite people by email: an invite is a grant waiting for an account. If the email already has an account the access is given at once; otherwise the invite is kept and
-- becomes a grant the moment that email's account is made (by the invite email, or by the person signing up). Anyone who signs up WITHOUT an invite has no access until an administrator approves them.
create table if not exists public.access_invites (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  program     text not null references public.programs(id) on delete cascade,
  level       text not null,
  expires_at  date,
  invited_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  foreign key (program, level) references public.program_levels(program, level)
);
create unique index if not exists access_invites_email_program_idx on public.access_invites (lower(email), program);
alter table public.access_invites enable row level security;
revoke all on public.access_invites from anon, authenticated;

-- the same limits as giving access directly: a manager may only invite up to the level they may give
create or replace function public.invite_person(p_email text, p_program text, p_level text, p_expires date default null)
returns text language plpgsql security definer set search_path = '' as $$
declare em text := lower(trim(p_email)); uid uuid; r int; adm boolean;
begin
  if not public.is_program_manager(p_program) then raise exception 'You do not manage %', p_program; end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'That does not look like an email address'; end if;
  adm := public.is_admin();
  select l.rank into r from public.program_levels l where l.program = p_program and l.level = p_level;
  if r is null then raise exception 'No such level'; end if;
  if not adm and (r > public.grant_limit(p_program) or exists (select 1 from public.program_levels l where l.program = p_program and l.level = p_level and l.admin_only)) then
    raise exception 'You may not give that level';
  end if;
  select id into uid from auth.users where lower(email) = em;
  if uid is not null then
    insert into public.access_grants (user_id, program, level, expires_at, granted_by) values (uid, p_program, p_level, p_expires, auth.uid())
    on conflict (user_id, program) do update set level = excluded.level, expires_at = excluded.expires_at;
    return 'granted';
  end if;
  insert into public.access_invites (email, program, level, expires_at, invited_by) values (em, p_program, p_level, p_expires, auth.uid())
  on conflict (lower(email), program) do update set level = excluded.level, expires_at = excluded.expires_at, invited_by = excluded.invited_by;
  return 'invited';
end $$;
revoke all on function public.invite_person(text, text, text, date) from public, anon;
grant execute on function public.invite_person(text, text, text, date) to authenticated;

create or replace function public.program_invites(p text)
returns table (id uuid, email text, level text, expires_at date, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select i.id, i.email, i.level, i.expires_at, i.created_at from public.access_invites i where i.program = p and public.is_program_manager(p) order by i.created_at desc
$$;
revoke all on function public.program_invites(text) from public, anon;
grant execute on function public.program_invites(text) to authenticated;

create or replace function public.delete_invite(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare prog text;
begin
  select program into prog from public.access_invites where id = p_id;
  if prog is null then raise exception 'No such invite'; end if;
  if not public.is_program_manager(prog) then raise exception 'You do not manage %', prog; end if;
  delete from public.access_invites where id = p_id;
end $$;
revoke all on function public.delete_invite(uuid) from public, anon;
grant execute on function public.delete_invite(uuid) to authenticated;

-- when an account is made for an invited email, the invites become grants
create or replace function public.apply_invites() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.access_grants (user_id, program, level, expires_at, granted_by)
  select new.id, i.program, i.level, i.expires_at, i.invited_by from public.access_invites i where lower(i.email) = lower(new.email)
  on conflict (user_id, program) do nothing;
  delete from public.access_invites where lower(email) = lower(new.email);
  return new;
end $$;
drop trigger if exists apply_invites on auth.users;
create trigger apply_invites after insert on auth.users for each row execute function public.apply_invites();
