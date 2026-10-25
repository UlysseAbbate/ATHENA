-- Access model tests: who may grant what, to whom, in which program. Runs as the real API roles with fake sign-ins.
\set ON_ERROR_STOP 0
create schema t;
create table t.results (ok boolean, name text, detail text);
grant usage on schema t to public;
create function t.record(ok boolean, name text, detail text) returns void language sql security definer as $$ insert into t.results values (ok, name, detail) $$;
create function t.as_user(uid uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), false); execute 'set role authenticated'; end $$;
create function t.as_service() returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', '', false); execute 'set role service_role'; end $$;
create function t.as_super() returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', '', false); execute 'reset role'; end $$;
-- the statement must succeed
create function t.ok(q text, name text) returns void language plpgsql as $$
declare m text; begin
  begin execute q; m := null; exception when others then m := sqlerrm; end;
  perform t.record(m is null, name, m); end $$;
-- the statement must fail with a message containing `pat`
create function t.fails(q text, pat text, name text) returns void language plpgsql as $$
declare m text; begin
  begin execute q; m := 'it succeeded'; exception when others then m := sqlerrm; end;
  perform t.record(m ilike '%' || pat || '%' and m <> 'it succeeded', name, m); end $$;
-- a one-value query must return `want`
create function t.eq(q text, want text, name text) returns void language plpgsql as $$
declare got text; begin
  begin execute q into got; exception when others then got := 'error: ' || sqlerrm; end;
  perform t.record(got is not distinct from want, name, 'got ' || coalesce(got, 'null') || ', wanted ' || coalesce(want, 'null')); end $$;

-- people (the admin's email is bound as in production)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'ulysse.abbate@gmail.com'),
  ('00000000-0000-0000-0000-0000000000c1', 'core@t.invalid'),
  ('00000000-0000-0000-0000-0000000000e1', 'member@t.invalid'),
  ('00000000-0000-0000-0000-0000000000b1', 'lucienmgr@t.invalid'),
  ('00000000-0000-0000-0000-0000000000b2', 'libbymgr@t.invalid'),
  ('00000000-0000-0000-0000-0000000000d1', 'peer@t.invalid'),
  ('00000000-0000-0000-0000-0000000000f1', 'outsider@t.invalid'),
  ('00000000-0000-0000-0000-0000000000f2', 'libbyadmin@t.invalid');
\set A '''00000000-0000-0000-0000-00000000000a'''
\set CORE '''00000000-0000-0000-0000-0000000000c1'''
\set MEM '''00000000-0000-0000-0000-0000000000e1'''
\set LM '''00000000-0000-0000-0000-0000000000b1'''
\set BM '''00000000-0000-0000-0000-0000000000b2'''
\set PEER '''00000000-0000-0000-0000-0000000000d1'''
\set OUT '''00000000-0000-0000-0000-0000000000f1'''
\set LADM '''00000000-0000-0000-0000-0000000000f2'''

-- setup as the SQL editor would
update public.profiles set role = 'core_team' where id = :CORE;
update public.profiles set role = 'member' where id = :MEM;
insert into public.access_grants (user_id, program, level, is_manager) values
  (:LM, 'lucien', 'access', true),
  (:BM, 'libby', 'staff', true),
  (:PEER, 'libby', 'peers', false),
  (:LADM, 'libby', 'admin', false);
update public.access_grants set grant_ceiling = 3 where user_id = :BM;

select t.eq($$select count(*)::text from public.access_grants where program = 'lovelace'$$, '3', 'Mall roles are mirrored into Lovelace grants (admin, core, member)');
select t.eq($$select is_manager::text from public.access_grants where user_id = '00000000-0000-0000-0000-0000000000c1' and program = 'lovelace'$$, 'true', 'core team become Lovelace managers (keeps today''s Team & access rights)');
select t.eq($$select is_manager::text from public.access_grants where user_id = '00000000-0000-0000-0000-0000000000e1' and program = 'lovelace'$$, 'false', 'a member is not a manager');
update public.profiles set role = null where id = :MEM;
select t.eq($$select count(*)::text from public.access_grants where user_id = '00000000-0000-0000-0000-0000000000e1' and program = 'lovelace'$$, '0', 'removing a Mall role removes the Lovelace grant');
update public.profiles set role = 'member', access_until = current_date + 5 where id = :MEM;
select t.eq($$select expires_at::text from public.access_grants where user_id = '00000000-0000-0000-0000-0000000000e1' and program = 'lovelace'$$, (current_date + 5)::text, 'the Mall access date is mirrored');

-- Lucien manager
select t.as_user(:LM);
select t.ok($$insert into public.access_grants (user_id, program, level) values ('00000000-0000-0000-0000-0000000000f1', 'lucien', 'access')$$, 'Lucien manager gives Lucien access');
select t.fails($$insert into public.access_grants (user_id, program, level, is_manager) values ('00000000-0000-0000-0000-0000000000e1', 'lucien', 'access', true)$$, 'Only the admin can make', 'a manager cannot make another manager');
select t.fails($$update public.access_grants set is_manager = false where user_id = '00000000-0000-0000-0000-0000000000b1' and program = 'lucien'$$, 'own access', 'a manager cannot change their own grant');
select t.fails($$insert into public.access_grants (user_id, program, level) values ('00000000-0000-0000-0000-00000000000a', 'lucien', 'access')$$, 'admin', 'a manager cannot touch the admin''s access');
select t.fails($$insert into public.access_grants (user_id, program, level) values ('00000000-0000-0000-0000-0000000000f1', 'libby', 'peers')$$, 'do not manage', 'a Lucien manager cannot grant in LIBBY');
select t.fails($$insert into public.access_grants (user_id, program, level) values ('00000000-0000-0000-0000-0000000000e1', 'lovelace', 'member')$$, 'managed in The Mall', 'Lovelace grants are only changed through the Mall until phase 3');
select t.fails($$select public.set_manager('00000000-0000-0000-0000-0000000000f1', 'lucien', true)$$, 'Only the admin', 'a manager cannot use set_manager');
select t.ok($$select public.grant_access('member@t.invalid', 'lucien', 'access', null)$$, 'grant by email works for a manager');
select t.fails($$select public.grant_access('nobody@t.invalid', 'lucien', 'access', null)$$, 'No account', 'grant by email says when there is no account');
select t.eq($$select count(*)::text from public.access_grants where program <> 'lucien' and user_id <> '00000000-0000-0000-0000-0000000000b1'$$, '0', 'a Lucien manager sees only Lucien people (and their own grants)');
select t.eq($$select count(*)::text from public.program_people('lucien')$$, '3', 'program_people lists the program''s people');
select t.eq($$select count(*)::text from public.program_people('libby')$$, '0', 'program_people is empty for a program they do not manage');
select t.eq($$select (public.can('ulysse', 'read'))::text$$, 'true', 'a Lucien grant opens Lucien (Ulysse data)');
select t.eq($$select public.my_access() -> 'programs' -> 'lucien' ->> 'manager'$$, 'true', 'my_access reports manager status');
select t.eq($$select public.my_access() -> 'programs' -> 'lucien' ->> 'limit'$$, '2147483647', 'my_access reports how high a manager may grant');
select t.ok($$delete from public.access_grants where user_id = '00000000-0000-0000-0000-0000000000f1' and program = 'lucien'$$, 'a manager can revoke a person');
select t.as_super();

-- LIBBY manager with a ceiling of rank 3
select t.as_user(:BM);
select t.ok($$insert into public.access_grants (user_id, program, level) values ('00000000-0000-0000-0000-0000000000f1', 'libby', 'staff')$$, 'a manager gives a level up to their ceiling');
select t.fails($$update public.access_grants set level = 'admin' where user_id = '00000000-0000-0000-0000-0000000000f1' and program = 'libby'$$, 'may not give', 'a manager cannot give an admin-only level');
select t.fails($$update public.access_grants set level = 'peers' where user_id = '00000000-0000-0000-0000-0000000000f2' and program = 'libby'$$, 'above what you may change', 'a manager cannot lower someone above them');
select t.fails($$delete from public.access_grants where user_id = '00000000-0000-0000-0000-0000000000f2' and program = 'libby'$$, 'above what you may change', 'a manager cannot remove someone above them');
select t.ok($$update public.access_grants set level = 'whips', expires_at = current_date + 30 where user_id = '00000000-0000-0000-0000-0000000000d1' and program = 'libby'$$, 'a manager changes a level and end date');
select t.fails($$update public.access_grants set program = 'lucien' where user_id = '00000000-0000-0000-0000-0000000000d1' and program = 'libby'$$, 'permission denied', 'a grant''s program cannot be edited at all');
select t.fails($$update public.access_grants set user_id = '00000000-0000-0000-0000-0000000000e1' where user_id = '00000000-0000-0000-0000-0000000000d1' and program = 'libby'$$, 'permission denied', 'user_id cannot be edited at all');
select t.eq($$select count(*)::text from public.access_grants where program = 'lucien'$$, '0', 'a LIBBY manager does not see Lucien grants');
select t.as_super();

-- a person with no manager rights
select t.as_user(:PEER);
select t.fails($$insert into public.access_grants (user_id, program, level) values ('00000000-0000-0000-0000-0000000000f1', 'libby', 'peers')$$, 'do not manage', 'a non-manager cannot grant');
select t.eq($$select count(*)::text from public.access_grants$$, '1', 'a person sees only their own grants');
select t.ok($$update public.access_grants set level = 'staff' where user_id = '00000000-0000-0000-0000-0000000000d1'$$, 'a person''s own update is accepted but matches no row');
select t.eq($$select level from public.access_grants where user_id = '00000000-0000-0000-0000-0000000000d1'$$, 'whips', 'a person cannot raise their own level');
select t.eq($$select count(*)::text from public.program_people('libby')$$, '0', 'a non-manager gets no people list');
select t.eq($$select (public.can('ulysse', 'read'))::text$$, 'false', 'no Lucien grant: Lucien stays closed');
select t.eq($$select public.all_people()::text$$, '[]', 'all_people is admin only');
select t.fails($$select * from public.access_codes where code_hash is not null$$, 'permission denied', 'code hashes cannot be read through the API');
select t.as_super();

-- expiry
update public.access_grants set expires_at = current_date - 1 where user_id = :LM and program = 'lucien';
select t.as_user(:LM);
select t.eq($$select (public.can('ulysse', 'read'))::text$$, 'false', 'an ended Lucien grant opens nothing');
select t.eq($$select (public.is_program_manager('lucien'))::text$$, 'false', 'an ended manager is not a manager');
select t.fails($$insert into public.access_grants (user_id, program, level) values ('00000000-0000-0000-0000-0000000000f1', 'lucien', 'access')$$, 'do not manage', 'an ended manager cannot grant');
select t.as_super();
update public.access_grants set expires_at = null where user_id = :LM and program = 'lucien';

-- the admin
select t.as_user(:A);
select t.ok($$select public.set_manager('00000000-0000-0000-0000-0000000000d1', 'libby', true, 2)$$, 'admin makes a manager with a ceiling');
select t.fails($$select public.set_manager('00000000-0000-0000-0000-0000000000f1', 'lucien', true)$$, 'Give them a level', 'a manager needs a level first');
select t.fails($$select public.set_manager('00000000-0000-0000-0000-0000000000c1', 'lovelace', false)$$, 'managed in The Mall', 'Lovelace managers follow the Mall roles for now');
select t.ok($$update public.access_grants set level = 'admin' where user_id = '00000000-0000-0000-0000-0000000000f1' and program = 'libby'$$, 'admin gives an admin-only level');
select t.eq($$select count(*)::text from public.access_grants$$, (select count(*)::text from public.access_grants), 'admin sees every grant');
select t.eq($$select jsonb_array_length(public.all_people())::text$$, '8', 'all_people lists every account');
select t.eq($$select (public.is_program_manager('libby'))::text$$, 'true', 'admin manages every program');
select t.eq($$select public.program_level('libby')$$, 'admin', 'admin has each program''s top level');
select t.as_super();
select t.as_user(:PEER);
select t.fails($$insert into public.access_grants (user_id, program, level) values ('00000000-0000-0000-0000-0000000000e1', 'libby', 'staff')$$, 'may not give', 'a ceiling of 2 stops a manager giving rank 3');
select t.ok($$insert into public.access_grants (user_id, program, level) values ('00000000-0000-0000-0000-0000000000e1', 'libby', 'whips')$$, 'a ceiling of 2 allows rank 2');
select t.as_super();

-- access codes
select t.as_user(:BM);
select t.ok($$select public.create_access_code('Peers', 'libby', 'peers', null, null, 'peers-basic-pass')$$, 'a manager makes a code with their own simple password');
select t.fails($$select public.create_access_code('Short', 'libby', 'peers', null, null, 'abc')$$, 'at least 8', 'a code needs 8 characters');
select t.fails($$select public.create_access_code('Dup', 'libby', 'whips', null, null, 'peers-basic-pass')$$, 'already in use', 'two live codes cannot share a password');
select t.fails($$select public.create_access_code('Boss', 'libby', 'admin', null, null)$$, 'cannot give that level', 'a code can never give an admin-only level');
select t.fails($$select public.create_access_code('Other', 'lucien', 'access', null, null)$$, 'do not manage', 'a manager cannot make a code for another program');
select t.eq($$select length(public.create_access_code('Random', 'libby', 'peers', null, 1))::text$$, '24', 'a random code is made when none is given (4x5 + dashes = 24)');
select t.fails($$select * from public.redeem_access_code('peers-basic-pass')$$, 'permission denied', 'signed-in users cannot redeem codes directly');
select t.eq($$select count(*)::text from public.access_codes$$, '2', 'a manager sees their program''s codes');
select t.as_super();
select t.as_user(:LM);
select t.eq($$select count(*)::text from public.access_codes$$, '0', 'another program''s manager does not see them');
select t.as_super();
select t.as_service();
select t.eq($$select level from public.redeem_access_code('peers-basic-pass')$$, 'peers', 'the sign-in function redeems a right code');
select t.eq($$select count(*)::text from public.redeem_access_code('wrong-password')$$, '0', 'a wrong code gives nothing');
select t.eq($$select uses::text from public.access_codes where label = 'Peers'$$, '1', 'uses are counted');
select t.as_super();
update public.access_codes set max_uses = 1 where label = 'Peers';
select t.as_service();
select t.eq($$select count(*)::text from public.redeem_access_code('peers-basic-pass')$$, '0', 'a used-up code stops working');
select t.as_super();
update public.access_codes set max_uses = null where label = 'Peers';
update public.access_codes set expires_at = now() - interval '1 minute' where label = 'Peers';
select t.as_service();
select t.eq($$select count(*)::text from public.redeem_access_code('peers-basic-pass')$$, '0', 'an expired code stops working');
select t.as_super();
update public.access_codes set expires_at = null where label = 'Peers';
select t.as_user(:BM);
select t.ok($$select public.revoke_access_code((select id from public.access_codes where label = 'Peers'))$$, 'a manager switches a code off');
select t.as_super();
select t.as_service();
select t.eq($$select count(*)::text from public.redeem_access_code('peers-basic-pass')$$, '0', 'a revoked code stops working');
select t.as_super();
select id as rid from public.access_codes where label = 'Random' \gset
select t.as_user(:LM);
select t.fails('select public.revoke_access_code(''' || :'rid' || ''')', 'do not manage', 'a manager cannot switch off another program''s code');
select t.as_super();

-- a code's hidden account (what the code sign-in function creates and signs in as)
select t.as_super();
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c9', 'code-x@codes.invalid');
select t.as_user(:BM);
select public.create_access_code('Whips room', 'libby', 'whips', null, null, 'whips-room-pass');
select t.as_super();
select id as wid from public.access_codes where label = 'Whips room' \gset
select t.as_service();
select t.ok('select public.link_code_identity(''' || :'wid' || ''', ''00000000-0000-0000-0000-0000000000c9'')', 'the sign-in function links a code to its hidden account');
select t.eq($$select public.level_of('00000000-0000-0000-0000-0000000000c9', 'libby')$$, 'whips', 'the hidden account has the code''s level');
select t.eq($$select coalesce(public.level_of('00000000-0000-0000-0000-0000000000c9', 'lucien'), 'none')$$, 'none', 'and nothing in other programs');
select t.eq($$select public.level_of('00000000-0000-0000-0000-00000000000a', 'libby')$$, 'admin', 'the admin has the top LIBBY level');
select t.as_super();
update public.access_codes set revoked_at = now() where id = :'wid';
select t.as_service();
select t.eq($$select coalesce(public.level_of('00000000-0000-0000-0000-0000000000c9', 'libby'), 'none')$$, 'none', 'switching the code off removes the hidden account''s access at once');
select t.as_super();
update public.access_codes set revoked_at = null where id = :'wid';
select t.as_user('00000000-0000-0000-0000-0000000000c9');
select t.eq($$select (public.has_program('libby'))::text$$, 'true', 'the hidden account passes the program check while the code is live');
select t.eq($$select (public.can('ulysse', 'read'))::text$$, 'false', 'and gets nothing in Lucien');
select t.as_super();
select t.as_user(:BM);
select t.eq($$select count(*)::text from public.program_people('libby') where email like '%codes.invalid'$$, '0', 'code accounts are not listed as people');
select t.as_super();
select t.as_user(:A);
select t.fails($$select public.create_access_code('Mall', 'lovelace', 'member', null, null)$$, 'Lovelace codes', 'codes cannot be made for Lovelace yet');
select t.eq($$select count(*)::text from public.profiles where email like '%codes.invalid'$$, '0', 'code accounts are hidden from the Mall''s team list');
select t.eq($$select (jsonb_array_length(public.all_people()) = 8)::text$$, 'true', 'and from the admin People list');
select t.as_super();

select t.as_service();
select t.ok($$select public.libby_reset_sequences()$$, 'LIBBY id counters can be moved past copied rows');
select t.as_super();
select t.as_user('00000000-0000-0000-0000-0000000000f1');
select t.fails($$select * from public.api_snapshots$$, 'permission denied', 'signed-in users cannot read LIBBY tables through the API');
select t.fails($$select public.libby_reset_sequences()$$, 'permission denied', 'nor run its maintenance functions');
select t.as_super();

-- campaign plan sections: constituencies are editable by local party chairs and above, the other sections as before
select t.eq($$select count(*)::text from public.plan_categories where constituency$$, '15', 'the plan has a section for each of the 14 GLA constituencies and one for all');
select t.as_super();
insert into public.plan_categories (name, sort, shared) values ('Media (test)', 40, false);
update public.profiles set role = 'member' where id = :MEM;
select t.as_user(:MEM);
select t.fails($$insert into public.plan_entries (plan_date, category_id, content) values (current_date, (select id from public.plan_categories where name = 'Constituency Activity: North East'), 'x')$$, 'row-level security', 'a member cannot edit a constituency section');
select t.eq($$select (count(*) > 0)::text from public.plan_categories where constituency$$, 'true', 'but can read them');
select t.as_super();
update public.profiles set role = 'local_party_chair' where id = :MEM;
select t.as_user(:MEM);
select t.ok($$insert into public.plan_entries (plan_date, category_id, content) values (current_date, (select id from public.plan_categories where name = 'Constituency Activity: North East'), 'chair entry')$$, 'a local party chair can edit a constituency section');
select t.fails($$insert into public.plan_entries (plan_date, category_id, content) values (current_date, (select id from public.plan_categories where name like 'Media%'), 'x')$$, 'row-level security', 'but not the media section');
select t.as_super();
update public.profiles set role = 'member' where id = :MEM;

-- audit
select t.eq($$select (count(*) > 0)::text from public.audit_log where table_name = 'access_grants' and label = 'peer@t.invalid · libby · peers'$$, 'true', 'grants are audited with person, program and level');
select t.eq($$select (count(*) > 0)::text from public.audit_log where table_name = 'access_codes'$$, 'true', 'codes are audited');
select t.eq($$select (count(*) = 0)::text from public.audit_log where changed @> array['uses']$$, 'true', 'code use counts are not logged as changes');

\echo
select case when ok then 'PASS' else 'FAIL' end || '  ' || name || case when ok then '' else '  -> ' || coalesce(detail, '') end as result from t.results order by ok, name;
select count(*) filter (where ok) || '/' || count(*) || ' passed' as total from t.results;
\o /dev/null
select set_config('t.failed', (select count(*) filter (where not ok) from t.results)::text, false);
\o
do $$ begin if (select count(*) from t.results where not ok) > 0 then raise exception 'database tests failed'; end if; end $$;
