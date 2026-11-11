-- LIBBY's roles, renamed and extended (Whips Hub):
--   Backbench parliamentarian, Frontbencher parliamentarian, Whip, Leader's circle, each with their own Staff, and Administrator.
-- Old -> new: Peer -> Backbench parliamentarian, Spokesperson -> Frontbencher parliamentarian, Staff -> Leader's circle's Staff (Leader's office stays, as Leader's circle).
-- Ranks: Backbench / Frontbencher and their Staff 1, Whip and Whip's Staff 2, Leader's circle and its Staff 3, Administrator 4 (site/libby/js/pages.js is the source of truth for what each rank opens).
insert into public.program_levels (program, level, label, rank, admin_only) values
  ('libby', 'backbench', 'Backbench parliamentarian', 1, false),
  ('libby', 'backbench_staff', 'Backbench parliamentarian''s Staff', 1, false),
  ('libby', 'frontbench', 'Frontbencher parliamentarian', 1, false),
  ('libby', 'frontbench_staff', 'Frontbencher parliamentarian''s Staff', 1, false),
  ('libby', 'whips_staff', 'Whip''s Staff', 2, false),
  ('libby', 'leader_staff', 'Leader''s circle''s Staff', 3, false)
on conflict (program, level) do nothing;
update public.program_levels set label = 'Whip' where program = 'libby' and level = 'whips';
update public.program_levels set label = 'Leader''s circle', rank = 3 where program = 'libby' and level = 'leader';
update public.program_levels set label = 'Administrator' where program = 'libby' and level = 'admin';
update public.access_grants set level = case level when 'peers' then 'backbench' when 'spokesperson' then 'frontbench' when 'staff' then 'leader_staff' end where program = 'libby' and level in ('peers', 'spokesperson', 'staff');
update public.access_codes set level = case level when 'peers' then 'backbench' when 'spokesperson' then 'frontbench' when 'staff' then 'leader_staff' end where program = 'libby' and level in ('peers', 'spokesperson', 'staff');
alter table public.people_roles drop constraint if exists people_roles_role_check;
update public.people_roles set role = case role when 'peers' then 'backbench' when 'spokesperson' then 'frontbench' when 'staff' then 'leader_staff' end where role in ('peers', 'spokesperson', 'staff');
alter table public.people_roles add constraint people_roles_role_check check (role in ('backbench', 'frontbench', 'whips', 'leader', 'backbench_staff', 'frontbench_staff', 'whips_staff', 'leader_staff', 'admin'));
delete from public.program_levels where program = 'libby' and level in ('peers', 'spokesperson', 'staff');
