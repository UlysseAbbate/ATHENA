-- Deleting, as well as switching off: an access code can be deleted outright (its hidden sign-in account with it), and an Administrator can delete a person's account.
create or replace function public.delete_access_code(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare prog text; ident uuid;
begin
  select program, coalesce(identity_user_id, id) into prog, ident from public.access_codes where id = p_id;
  if prog is null then raise exception 'No such code'; end if;
  if not public.is_program_manager(prog) then raise exception 'You do not manage %', prog; end if;
  delete from public.access_codes where id = p_id;
  -- the hidden account a code signs people in as goes too, so nothing is left behind (and everyone using the code is signed out)
  if public.is_code_identity(ident) then
    delete from public.access_grants where user_id = ident;
    delete from auth.users where id = ident;
  end if;
end $$;
revoke all on function public.delete_access_code(uuid) from public, anon;
grant execute on function public.delete_access_code(uuid) to authenticated;

create or replace function public.delete_person(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Only an administrator can delete an account'; end if;
  if p_user = auth.uid() then raise exception 'You cannot delete your own account'; end if;
  if public.is_admin_user(p_user) then raise exception 'An administrator''s account cannot be deleted here'; end if;
  if public.is_code_identity(p_user) then raise exception 'That is the sign-in account of an access code: delete the code instead'; end if;
  delete from public.access_grants where user_id = p_user;
  delete from auth.users where id = p_user;
end $$;
revoke all on function public.delete_person(uuid) from public, anon;
grant execute on function public.delete_person(uuid) to authenticated;
