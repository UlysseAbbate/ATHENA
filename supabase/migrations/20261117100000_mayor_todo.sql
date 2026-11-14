-- LOVELACE: the Mayor's To-Do List: things for the Mayoral candidate to sign off.
-- The core team fills it (adds, edits, deletes). The Mayoral candidate (the Candidate role) and the executive can read it, and anyone who can read it can tick an item done
-- (a trigger lets them change only the tick, never the entry).
create table if not exists public.mayor_todos (
  id          uuid primary key default gen_random_uuid(),
  action      text not null check (char_length(action) between 1 and 500),
  responsible text,
  link        text,
  notes       text,
  done        boolean not null default false,
  done_at     timestamptz,
  done_by     uuid,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);
alter table public.mayor_todos enable row level security;
create policy mt_read   on public.mayor_todos for select to authenticated using ((select public.can('mayor_todo', 'read')));
create policy mt_insert on public.mayor_todos for insert to authenticated with check ((select public.can('mayor_todo', 'write')));
create policy mt_update on public.mayor_todos for update to authenticated using ((select public.can('mayor_todo', 'read'))) with check ((select public.can('mayor_todo', 'read')));
create policy mt_delete on public.mayor_todos for delete to authenticated using ((select public.can('mayor_todo', 'write')));

create or replace function public.guard_mayor_todo() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not (select public.can('mayor_todo', 'write')) and
     (new.action, new.responsible, new.link, new.notes, new.created_by, new.created_at) is distinct from (old.action, old.responsible, old.link, old.notes, old.created_by, old.created_at) then
    raise exception 'Only the core team can change the entries: you can tick an item done.';
  end if;
  if new.done is distinct from old.done then
    new.done_at := case when new.done then now() else null end;
    new.done_by := case when new.done then (select auth.uid()) else null end;
  end if;
  return new;
end $$;
revoke all on function public.guard_mayor_todo() from public, anon, authenticated;
drop trigger if exists mayor_todos_guard on public.mayor_todos;
create trigger mayor_todos_guard before update on public.mayor_todos for each row execute function public.guard_mayor_todo();
drop trigger if exists mayor_todos_touch on public.mayor_todos;
create trigger mayor_todos_touch before update on public.mayor_todos for each row execute function public.touch();
drop trigger if exists mayor_todos_audit on public.mayor_todos;
create trigger mayor_todos_audit after insert or update or delete on public.mayor_todos for each row execute function public.audit();

insert into public.role_permissions (role, resource, can_read, can_write) values
  ('core_team', 'mayor_todo', true, true), ('executive', 'mayor_todo', true, false), ('candidate', 'mayor_todo', true, false)
on conflict (role, resource) do nothing;

-- the core team keeps its right to edit and delete the list, like everything else in LOVELACE
create or replace function public.guard_core_permissions() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'core_team' and old.resource in ('dayplan_full', 'dayplan_volunteer', 'budget', 'volunteers_all', 'volunteers_add', 'stakeholders_all', 'stakeholders_add',
       'policies', 'social', 'coverage', 'visits', 'help_offer', 'help_inbox', 'mayor_todo')
     and (tg_op = 'DELETE' or not new.can_read or not new.can_write) then
    raise exception 'The core team always keeps the right to see, edit and delete this.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
