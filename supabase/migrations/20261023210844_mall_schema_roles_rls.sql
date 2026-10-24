create type public.app_role as enum ('core_team','executive','local_party_chair','candidate','support_team','member');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  role public.app_role,
  created_at timestamptz not null default now()
);
create table public.bootstrap_admins (email text primary key);
insert into public.bootstrap_admins values ('ulysse.abbate@gmail.com');

create table public.role_permissions (
  role public.app_role not null,
  resource text not null,
  can_read boolean not null default false,
  can_write boolean not null default false,
  primary key (role, resource)
);

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name',''),
          (select 'core_team'::public.app_role from public.bootstrap_admins b where lower(b.email) = lower(new.email)));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
revoke all on function public.handle_new_user() from public, anon, authenticated;

create function public.my_role() returns public.app_role
language sql stable security definer set search_path = '' as
$$ select role from public.profiles where id = (select auth.uid()) $$;

create function public.can(res text, act text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select case act when 'read' then rp.can_read when 'write' then rp.can_write end
                   from public.role_permissions rp
                   where rp.role = public.my_role() and rp.resource = res), false)
$$;
revoke all on function public.my_role() from public, anon;
revoke all on function public.can(text, text) from public, anon;
grant execute on function public.my_role() to authenticated;
grant execute on function public.can(text, text) to authenticated;

create function public.update_my_name(new_name text) returns void
language sql security definer set search_path = '' as
$$ update public.profiles set full_name = left(new_name, 120) where id = (select auth.uid()) $$;
revoke all on function public.update_my_name(text) from public, anon;
grant execute on function public.update_my_name(text) to authenticated;

create table public.plan_categories (
  id serial primary key,
  name text not null unique,
  sort int not null default 0,
  shared boolean not null default false
);
create table public.plan_entries (
  id uuid primary key default gen_random_uuid(),
  plan_date date not null,
  category_id int not null references public.plan_categories(id) on delete cascade,
  content text not null,
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);
create index plan_entries_date_idx on public.plan_entries (plan_date);
create index plan_entries_cat_idx on public.plan_entries (category_id);

create table public.local_party_visits (
  id uuid primary key default gen_random_uuid(),
  local_party text not null, request text, taken_by text, actioning text, happening text,
  visit_date date, contact_name text, contact_phone text, notes text,
  created_at timestamptz not null default now()
);
create table public.budget_items (
  id uuid primary key default gen_random_uuid(),
  item text not null, amount numeric(12,2), category text, notes text,
  created_at timestamptz not null default now()
);
create table public.governance_items (
  id uuid primary key default gen_random_uuid(),
  title text not null, area text not null default 'Legal', status text not null default 'To do',
  owner text, due_date date, notes text,
  created_at timestamptz not null default now()
);
create table public.policies (
  id uuid primary key default gen_random_uuid(),
  policy text not null, theme text, briefing text, actions text, interested_parties text, comms text, notes text,
  created_at timestamptz not null default now()
);
create table public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  organisation text not null,
  platform text not null check (platform in ('Instagram','Facebook','Twitter','BlueSky','Substack','TikTok','LinkedIn')),
  handle text, url text, notes text,
  unique (organisation, platform)
);
create table public.social_posts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.social_accounts(id) on delete cascade,
  posted_at timestamptz, url text, summary text, topic text,
  added_at timestamptz not null default now()
);
create index social_posts_account_idx on public.social_posts (account_id, posted_at desc);
create table public.content_items (
  id uuid primary key default gen_random_uuid(),
  name text not null, platforms text, creator text, proof_read text, content_type text,
  description text, drive_link text, scheduled date, status text,
  created_at timestamptz not null default now()
);
create table public.media_coverage (
  id uuid primary key default gen_random_uuid(),
  covered_on date not null, outlet text not null, headline text not null, url text, notes text,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  unique (url)
);
create table public.volunteers (
  id uuid primary key default gen_random_uuid(),
  name text not null, role_wanted text, email text, phone text,
  availability text, asked_by text, accepted boolean, notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create table public.stakeholders (
  id uuid primary key default gen_random_uuid(),
  name text not null, organisation text, sector text,
  email text, phone text, point_person_name text, point_person_contact text, owner text, notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.bootstrap_admins enable row level security;
alter table public.role_permissions enable row level security;
alter table public.plan_categories enable row level security;
alter table public.plan_entries enable row level security;
alter table public.volunteers enable row level security;
alter table public.stakeholders enable row level security;

create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.can('users','read'));
create policy profiles_admin_update on public.profiles for update to authenticated
  using (public.can('users','write')) with check (public.can('users','write'));

create policy perms_read on public.role_permissions for select to authenticated using (true);
create policy perms_write on public.role_permissions for all to authenticated
  using (public.can('permissions','write')) with check (public.can('permissions','write'));

create policy plan_cat_read on public.plan_categories for select to authenticated
  using (public.can('plan_full','read') or (shared and public.can('plan_shared','read')));
create policy plan_cat_write on public.plan_categories for all to authenticated
  using (public.can('plan_full','write')) with check (public.can('plan_full','write'));

create policy plan_read on public.plan_entries for select to authenticated using (
  public.can('plan_full','read') or
  (public.can('plan_shared','read') and exists (select 1 from public.plan_categories c where c.id = category_id and c.shared)));
create policy plan_insert on public.plan_entries for insert to authenticated with check (
  public.can('plan_full','write') or
  (public.can('plan_shared','write') and exists (select 1 from public.plan_categories c where c.id = category_id and c.shared)));
create policy plan_update on public.plan_entries for update to authenticated using (
  public.can('plan_full','write') or
  (public.can('plan_shared','write') and exists (select 1 from public.plan_categories c where c.id = category_id and c.shared)))
  with check (
  public.can('plan_full','write') or
  (public.can('plan_shared','write') and exists (select 1 from public.plan_categories c where c.id = category_id and c.shared)));
create policy plan_delete on public.plan_entries for delete to authenticated using (
  public.can('plan_full','write') or
  (public.can('plan_shared','write') and exists (select 1 from public.plan_categories c where c.id = category_id and c.shared)));

do $$
declare t record;
begin
  for t in select * from (values
    ('local_party_visits','visits'), ('budget_items','budget'), ('governance_items','budget'),
    ('policies','policies'), ('social_accounts','social'), ('social_posts','social'),
    ('content_items','social'), ('media_coverage','coverage')) as v(tbl, res)
  loop
    execute format('alter table public.%I enable row level security', t.tbl);
    execute format('create policy %I on public.%I for select to authenticated using (public.can(%L,''read''))', t.tbl||'_r', t.tbl, t.res);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.can(%L,''write''))', t.tbl||'_i', t.tbl, t.res);
    execute format('create policy %I on public.%I for update to authenticated using (public.can(%L,''write'')) with check (public.can(%L,''write''))', t.tbl||'_u', t.tbl, t.res, t.res);
    execute format('create policy %I on public.%I for delete to authenticated using (public.can(%L,''write''))', t.tbl||'_d', t.tbl, t.res);
  end loop;
end $$;

create policy vol_read on public.volunteers for select to authenticated
  using (public.can('volunteers_all','read') or created_by = (select auth.uid()));
create policy vol_insert on public.volunteers for insert to authenticated
  with check (public.can('volunteers_add','write') and created_by = (select auth.uid()));
create policy vol_update on public.volunteers for update to authenticated
  using (public.can('volunteers_all','write') or created_by = (select auth.uid()))
  with check (public.can('volunteers_all','write') or created_by = (select auth.uid()));
create policy vol_delete on public.volunteers for delete to authenticated
  using (public.can('volunteers_all','write') or created_by = (select auth.uid()));

create policy sh_read on public.stakeholders for select to authenticated
  using (public.can('stakeholders_all','read') or created_by = (select auth.uid()));
create policy sh_insert on public.stakeholders for insert to authenticated
  with check (public.can('stakeholders_add','write') and created_by = (select auth.uid()));
create policy sh_update on public.stakeholders for update to authenticated
  using (public.can('stakeholders_all','write') or created_by = (select auth.uid()))
  with check (public.can('stakeholders_all','write') or created_by = (select auth.uid()));
create policy sh_delete on public.stakeholders for delete to authenticated
  using (public.can('stakeholders_all','write') or created_by = (select auth.uid()));

insert into public.role_permissions (role, resource, can_read, can_write)
select r::public.app_role, res, rd, wr from (values
  ('core_team','plan_full',true,true), ('core_team','plan_shared',true,true), ('core_team','budget',true,true),
  ('core_team','volunteers_all',true,true), ('core_team','volunteers_add',true,true), ('core_team','policies',true,true),
  ('core_team','social',true,true), ('core_team','coverage',true,true), ('core_team','stakeholders_all',true,true),
  ('core_team','stakeholders_add',true,true), ('core_team','visits',true,true), ('core_team','users',true,true),
  ('core_team','permissions',true,true),
  ('executive','plan_full',true,true), ('executive','plan_shared',true,true), ('executive','budget',true,true),
  ('executive','volunteers_all',true,true), ('executive','volunteers_add',true,true), ('executive','social',true,false),
  ('executive','coverage',true,true), ('executive','stakeholders_all',true,true), ('executive','stakeholders_add',true,true),
  ('executive','visits',true,true),
  ('local_party_chair','plan_shared',true,false), ('local_party_chair','volunteers_add',false,true),
  ('local_party_chair','stakeholders_add',false,true), ('local_party_chair','coverage',true,false),
  ('candidate','plan_shared',true,false), ('candidate','volunteers_add',false,true),
  ('candidate','stakeholders_add',false,true), ('candidate','coverage',true,false),
  ('support_team','plan_shared',true,false), ('support_team','volunteers_add',false,true),
  ('support_team','stakeholders_add',false,true), ('support_team','coverage',true,false),
  ('support_team','social',true,true),
  ('member','plan_shared',true,false), ('member','volunteers_add',false,true),
  ('member','stakeholders_add',false,true), ('member','coverage',true,false)
) as v(r,res,rd,wr);
