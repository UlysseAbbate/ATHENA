-- LOVELACE: the To-Do List has several lists (the Mayor's, the campaign's, the staff's, the volunteers'). Same table, same rights as before.
alter table public.mayor_todos add column if not exists list text not null default 'mayor';
alter table public.mayor_todos drop constraint if exists mayor_todos_list_check;
alter table public.mayor_todos add constraint mayor_todos_list_check check (list in ('mayor', 'campaign', 'staff', 'volunteers'));
create index if not exists mayor_todos_list_idx on public.mayor_todos (list);

create or replace function public.guard_mayor_todo() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not (select public.can('mayor_todo', 'write')) and
     (new.action, new.responsible, new.link, new.notes, new.list, new.created_by, new.created_at) is distinct from (old.action, old.responsible, old.link, old.notes, old.list, old.created_by, old.created_at) then
    raise exception 'Only the core team can change the entries: you can tick an item done.';
  end if;
  if new.done is distinct from old.done then
    new.done_at := case when new.done then now() else null end;
    new.done_by := case when new.done then (select auth.uid()) else null end;
  end if;
  return new;
end $$;
revoke all on function public.guard_mayor_todo() from public, anon, authenticated;
