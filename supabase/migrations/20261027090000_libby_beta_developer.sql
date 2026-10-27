-- LIBBY editions: a "Beta tester" level (sees only Comms, Policy and Data, read-only; the pages and routes enforce this) and a
-- "Developer" level above Admin for work in progress. Both are given from Athena's Access page; Developer only by the admin, and the
-- admin always has the top level, so it is you. Admin (rank 4) stays as it was for anyone already holding it.
insert into public.program_levels (program, level, label, rank, admin_only) values
  ('libby', 'beta',      'Beta tester', 1, false),
  ('libby', 'developer', 'Developer',   5, true)
on conflict (program, level) do nothing;
