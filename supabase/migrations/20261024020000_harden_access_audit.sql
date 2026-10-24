-- Hardening, time-limited access, grantable Ulysse, audit trail and edit-conflict protection.
-- Compatible with the previous front end (additive columns; same tables and RPCs).

------------------------------------------------------------------ least privilege
-- The site never reads data as an anonymous visitor: everything goes through a signed-in session and RLS.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
-- TRUNCATE/TRIGGER/REFERENCES are not covered by RLS and nothing needs them.
revoke truncate, references, trigger on all tables in schema public from authenticated;
-- Admin tables are only read by security-definer functions.
revoke all on public.admins, public.bootstrap_admins from authenticated;
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke all on functions from anon;
alter table public.bootstrap_admins drop column if exists password;   -- unused and always empty
create index if not exists admins_user_id_idx on public.admins (user_id);

------------------------------------------------------------------ time-limited access
-- A role can be given until a date (e.g. a temporary volunteer coordinator). After it, the person sees nothing.
alter table public.profiles add column if not exists access_until date;

create or replace function public.my_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select role from public.profiles
  where id = (select auth.uid())
    and (access_until is null or access_until >= (now() at time zone 'Europe/London')::date)
$$;

------------------------------------------------------------------ who may change whose access
-- Only role, name and access date are editable through the API; the rest is fixed.
revoke insert, update, delete on public.profiles from authenticated;
grant update (role, full_name, access_until) on public.profiles to authenticated;

create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or public.is_admin() then return new; end if;   -- SQL editor / service role / the admin
  if exists (select 1 from public.admins a where a.user_id = old.id or lower(a.email) = lower(old.email)) then
    raise exception 'Only the admin can change the admin''s account';
  end if;
  if (new.role is distinct from old.role or new.access_until is distinct from old.access_until) then
    if old.id = (select auth.uid()) then
      raise exception 'You cannot change your own role or access';
    end if;
    if (new.role = 'core_team' or old.role = 'core_team') and new.role is distinct from old.role
       and public.my_role() is distinct from 'core_team' then
      raise exception 'Only the core team can grant or remove core team access';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_profile_update() from public, anon, authenticated;
drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles for each row execute function public.guard_profile_update();

-- the trigger now protects the admin row, so the policy no longer needs the email lookup
drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles for update to authenticated
  using ((select public.can('users','write'))) with check ((select public.can('users','write')));
revoke execute on function public.is_admin_email(text) from authenticated;

-- the core team can never remove its own "Team & access" rights (no lock-out)
alter table public.role_permissions drop constraint if exists core_keeps_admin_rights;
alter table public.role_permissions add constraint core_keeps_admin_rights
  check (not (role = 'core_team' and resource in ('users','permissions')) or (can_read and can_write));

------------------------------------------------------------------ Ulysse: admin-only by default, grantable by the admin alone
insert into public.role_permissions (role, resource, can_read, can_write)
select r, x.res, x.rd, false
from unnest(enum_range(null::public.app_role)) r
cross join (values ('ulysse', false), ('audit', false)) x(res, rd)
on conflict do nothing;
update public.role_permissions set can_read = true where role = 'core_team' and resource = 'audit';

create or replace function public.guard_admin_only_resources() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null and not public.is_admin()
     and (case when tg_op = 'DELETE' then old.resource else new.resource end) in ('ulysse')
     or (tg_op = 'UPDATE' and old.resource in ('ulysse') and (select auth.uid()) is not null and not public.is_admin()) then
    raise exception 'Only the admin can grant access to Ulysse';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.guard_admin_only_resources() from public, anon, authenticated;
drop trigger if exists role_permissions_guard on public.role_permissions;
create trigger role_permissions_guard before insert or update or delete on public.role_permissions
  for each row execute function public.guard_admin_only_resources();

drop policy if exists ulysse_admin_read on public.ulysse_data;
create policy ulysse_data_read on public.ulysse_data for select to authenticated
  using ((select public.is_admin()) or (select public.can('ulysse','read')));

-- read/unread is now per person
alter table public.ulysse_read add column if not exists user_id uuid references auth.users(id) on delete cascade;
update public.ulysse_read set user_id = (select user_id from public.admins where user_id is not null limit 1) where user_id is null;
alter table public.ulysse_read alter column user_id set default auth.uid(), alter column user_id set not null;
alter table public.ulysse_read drop constraint if exists ulysse_read_pkey;
alter table public.ulysse_read add primary key (user_id, item_id);
drop policy if exists ulysse_read_r on public.ulysse_read;
drop policy if exists ulysse_read_i on public.ulysse_read;
drop policy if exists ulysse_read_u on public.ulysse_read;
drop policy if exists ulysse_read_d on public.ulysse_read;
create policy ulysse_read_own on public.ulysse_read for all to authenticated
  using (user_id = (select auth.uid()) and ((select public.is_admin()) or (select public.can('ulysse','read'))))
  with check (user_id = (select auth.uid()) and ((select public.is_admin()) or (select public.can('ulysse','read'))));

------------------------------------------------------------------ one round trip at sign-in
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
      left join public.role_permissions rp on rp.resource = r.resource and rp.role = public.my_role()), '{}'::jsonb))
$$;
revoke all on function public.my_access() from public, anon;
grant execute on function public.my_access() to authenticated;

-- last sign-in per person, for whoever may see the team list
create or replace function public.team_last_seen() returns table (id uuid, last_sign_in_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select u.id, u.last_sign_in_at from auth.users u where public.can('users','read')
$$;
revoke all on function public.team_last_seen() from public, anon;
grant execute on function public.team_last_seen() to authenticated;

------------------------------------------------------------------ last edited + edit-conflict protection
create or replace function public.touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['plan_entries','local_party_visits','budget_items','governance_items','policies','social_accounts',
                           'social_posts','content_items','media_coverage','volunteers','stakeholders']
  loop
    execute format('alter table public.%I add column if not exists updated_at timestamptz not null default now()', t);
    execute format('alter table public.%I add column if not exists updated_by uuid', t);
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.touch()', t || '_touch', t);
  end loop;
end $$;

------------------------------------------------------------------ audit trail (who changed what, when; not the values)
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid,
  user_email text,
  table_name text not null,
  row_id text,
  label text,
  action text not null,
  changed text[]
);
create index if not exists audit_log_at_idx on public.audit_log (at desc);
alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;
drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log for select to authenticated using ((select public.can('audit','read')));

create or replace function public.audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  ch text[];
begin
  if tg_op = 'UPDATE' then
    select array_agg(k order by k) into ch from jsonb_object_keys(r) k
    where r -> k is distinct from o -> k and k not in ('updated_at','updated_by');
    if ch is null then return null; end if;
  end if;
  insert into public.audit_log (user_id, user_email, table_name, row_id, label, action, changed)
  values ((select auth.uid()), (select p.email from public.profiles p where p.id = (select auth.uid())), tg_table_name,
          coalesce(r ->> 'id', (r ->> 'role') || '/' || (r ->> 'resource')),
          left(coalesce(r ->> 'name', r ->> 'headline', r ->> 'title', r ->> 'item', r ->> 'policy', r ->> 'local_party',
                        r ->> 'organisation', r ->> 'email', r ->> 'content', (r ->> 'role') || ' · ' || (r ->> 'resource')), 90),
          lower(tg_op), ch);
  return null;
end $$;
revoke all on function public.audit() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['plan_entries','plan_categories','local_party_visits','budget_items','governance_items','policies',
                           'social_accounts','social_posts','content_items','media_coverage','volunteers','stakeholders',
                           'profiles','role_permissions']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit()', t || '_audit', t);
  end loop;
end $$;

------------------------------------------------------------------ RLS performance
-- Evaluate permission checks once per query (initPlan) instead of once per row.
do $$
declare p record; q text; c text; stmt text;
begin
  for p in select * from pg_policies where schemaname = 'public' loop
    q := regexp_replace(p.qual, '(?<!SELECT )\m(can\([^()]*\)|is_admin\(\))', '(SELECT \1)', 'g');
    c := regexp_replace(p.with_check, '(?<!SELECT )\m(can\([^()]*\)|is_admin\(\))', '(SELECT \1)', 'g');
    if q is distinct from p.qual or c is distinct from p.with_check then
      stmt := format('alter policy %I on public.%I', p.policyname, p.tablename);
      if q is not null then stmt := stmt || format(' using (%s)', q); end if;
      if c is not null then stmt := stmt || format(' with check (%s)', c); end if;
      execute stmt;
    end if;
  end loop;
end $$;

-- one permissive policy per action (the ALL policies overlapped the SELECT ones)
drop policy if exists plan_cat_write on public.plan_categories;
create policy plan_cat_i on public.plan_categories for insert to authenticated with check ((select public.can('plan_full','write')));
create policy plan_cat_u on public.plan_categories for update to authenticated
  using ((select public.can('plan_full','write'))) with check ((select public.can('plan_full','write')));
create policy plan_cat_d on public.plan_categories for delete to authenticated using ((select public.can('plan_full','write')));
drop policy if exists perms_write on public.role_permissions;
create policy perms_i on public.role_permissions for insert to authenticated with check ((select public.can('permissions','write')));
create policy perms_u on public.role_permissions for update to authenticated
  using ((select public.can('permissions','write'))) with check ((select public.can('permissions','write')));
create policy perms_d on public.role_permissions for delete to authenticated using ((select public.can('permissions','write')));
