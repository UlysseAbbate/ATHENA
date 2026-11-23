-- LOVELACE Comms: Media (London Media Tracker, Lib Dem Media Tracker, Tracked accounts), Stories (pitches) and Policies (uploaded documents you can search).

-- 1. Media trackers: every entry has a persona (who), a channel (where) and a summary (the headline or caption).
alter table public.media_coverage add column if not exists persona text, add column if not exists channel text;
update public.media_coverage set persona = outlet where persona is null;
update public.media_coverage set channel = case when source = 'social' then 'Social' else 'Online news' end where channel is null;

-- the accounts say which tracker a persona belongs to; and there are more channels (print, a website)
alter table public.social_accounts add column if not exists tracker text not null default 'libdem' check (tracker in ('libdem', 'london'));
alter table public.social_accounts drop constraint if exists social_accounts_platform_check;
alter table public.social_accounts add constraint social_accounts_platform_check
  check (platform in ('Instagram', 'Facebook', 'Twitter', 'BlueSky', 'Substack', 'TikTok', 'LinkedIn', 'YouTube', 'Threads', 'Mastodon', 'Print media', 'Website', 'Other'));

-- 2. Stories: a pitch can be sent by every role and read only by those with the 'stories' read right (the core team).
create table if not exists public.story_pitches (
  id            uuid primary key default gen_random_uuid(),
  status        text not null default 'new' check (status in ('new', 'considering', 'used', 'declined')),
  pitched_by    uuid default auth.uid(),
  pitched_name  text,
  headline      text not null check (char_length(btrim(headline)) between 1 and 300 and array_length(regexp_split_to_array(btrim(headline), E'\n'), 1) <= 3),
  other_1       text,
  hook          text not null check (char_length(btrim(hook)) between 1 and 300),
  content       text not null check (char_length(btrim(content)) between 1 and 1500),
  turn          text not null check (char_length(btrim(turn)) between 1 and 1000),
  cta           text not null check (char_length(btrim(cta)) between 1 and 600),
  other_2       text,
  media         jsonb not null check (jsonb_typeof(media) = 'array' and jsonb_array_length(media) between 1 and 12),
  other_3       text,
  briefing_link text check (briefing_link is null or briefing_link ~ '^https?://'),
  briefing_file_name text,
  briefing_mime text,
  briefing_size int,
  briefing_data text,
  cost_estimate text not null check (char_length(btrim(cost_estimate)) between 1 and 500),
  orgs_work     jsonb not null check (jsonb_typeof(orgs_work) = 'array' and jsonb_array_length(orgs_work) between 1 and 12),
  other_4       text,
  set_piece     text not null check (set_piece in ('yes', 'no', 'not_sure')),
  set_piece_kind  text,
  set_piece_where text,
  other_5       text,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  check (briefing_link is not null or briefing_file_name is not null),
  check (set_piece <> 'yes' or (coalesce(btrim(set_piece_kind), '') <> '' and coalesce(btrim(set_piece_where), '') <> ''))
);
alter table public.story_pitches enable row level security;
create policy sp_insert on public.story_pitches for insert to authenticated with check ((select public.can('stories', 'write')) and pitched_by = (select auth.uid()));
create policy sp_read   on public.story_pitches for select to authenticated using ((select public.can('stories', 'read')));
create policy sp_update on public.story_pitches for update to authenticated using ((select public.can('stories', 'read')) and (select public.can('stories', 'write')))
  with check ((select public.can('stories', 'read')) and (select public.can('stories', 'write')));
create policy sp_delete on public.story_pitches for delete to authenticated using ((select public.can('stories', 'read')) and (select public.can('stories', 'write')));
drop trigger if exists story_pitches_touch on public.story_pitches;
create trigger story_pitches_touch before update on public.story_pitches for each row execute function public.touch();
drop trigger if exists story_pitches_audit on public.story_pitches;
create trigger story_pitches_audit after insert or update or delete on public.story_pitches for each row execute function public.audit();

-- 3. Policies: documents you upload (their text is kept in passages so they can be searched).
create table if not exists public.policy_docs (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(btrim(title)) between 1 and 300),
  theme       text,
  summary     text,
  file_name   text not null,
  mime        text,
  size_bytes  int,
  pages       int,
  chunk_count int not null default 0,
  uploaded_by uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);
create table if not exists public.policy_doc_files (
  doc_id uuid primary key references public.policy_docs(id) on delete cascade,
  data   text not null
);
create table if not exists public.policy_doc_chunks (
  id      bigserial primary key,
  doc_id  uuid not null references public.policy_docs(id) on delete cascade,
  n       int not null,
  content text not null,
  tsv     tsvector generated always as (to_tsvector('english', content)) stored
);
create index if not exists policy_doc_chunks_tsv_idx on public.policy_doc_chunks using gin (tsv);
create index if not exists policy_doc_chunks_doc_idx on public.policy_doc_chunks (doc_id, n);
alter table public.policy_docs enable row level security;
alter table public.policy_doc_files enable row level security;
alter table public.policy_doc_chunks enable row level security;
create policy pd_read   on public.policy_docs for select to authenticated using ((select public.can('policies', 'read')));
create policy pd_insert on public.policy_docs for insert to authenticated with check ((select public.can('policies', 'write')));
create policy pd_update on public.policy_docs for update to authenticated using ((select public.can('policies', 'write'))) with check ((select public.can('policies', 'write')));
create policy pd_delete on public.policy_docs for delete to authenticated using ((select public.can('policies', 'write')));
create policy pdf_read   on public.policy_doc_files for select to authenticated using ((select public.can('policies', 'read')));
create policy pdf_insert on public.policy_doc_files for insert to authenticated with check ((select public.can('policies', 'write')));
create policy pdf_delete on public.policy_doc_files for delete to authenticated using ((select public.can('policies', 'write')));
create policy pdc_read   on public.policy_doc_chunks for select to authenticated using ((select public.can('policies', 'read')));
create policy pdc_insert on public.policy_doc_chunks for insert to authenticated with check ((select public.can('policies', 'write')));
create policy pdc_delete on public.policy_doc_chunks for delete to authenticated using ((select public.can('policies', 'write')));
drop trigger if exists policy_docs_touch on public.policy_docs;
create trigger policy_docs_touch before update on public.policy_docs for each row execute function public.touch();
drop trigger if exists policy_docs_audit on public.policy_docs;
create trigger policy_docs_audit after insert or update or delete on public.policy_docs for each row execute function public.audit();

-- the search: the best passage of each document, with the matching words marked (runs as the caller, so the table rules above apply)
drop function if exists public.search_policy_docs(text, text, int);
create function public.search_policy_docs(q text, theme_filter text default null, max_results int default 40)
returns table (doc_id uuid, title text, theme text, file_name text, created_at timestamptz, extract_text text, rank real)
language sql stable security invoker set search_path = public, pg_catalog as $$
  with query as (select websearch_to_tsquery('english', q) as tsq),
  hits as (
    select c.doc_id, c.content, ts_rank_cd(c.tsv, query.tsq) as rank,
           row_number() over (partition by c.doc_id order by ts_rank_cd(c.tsv, query.tsq) desc) as rn
    from public.policy_doc_chunks c, query where c.tsv @@ query.tsq)
  select d.id, d.title, d.theme, d.file_name, d.created_at,
         ts_headline('english', h.content, (select tsq from query), 'StartSel=<mark>, StopSel=</mark>, MaxWords=45, MinWords=20, MaxFragments=2, FragmentDelimiter=" ... "') as extract_text, h.rank
  from hits h join public.policy_docs d on d.id = h.doc_id
  where h.rn = 1 and (theme_filter is null or d.theme = theme_filter)
  order by h.rank desc, d.created_at desc
  limit greatest(1, least(max_results, 100));
$$;
revoke all on function public.search_policy_docs(text, text, int) from public, anon;
grant execute on function public.search_policy_docs(text, text, int) to authenticated;

-- 4. Who can do what. Stories: every role may send a pitch (write), only the core team reads. Policies: read by the Local party chair and above (not the Support team or Members).
insert into public.role_permissions (role, resource, can_read, can_write)
select r, 'stories', r = 'core_team', true
from unnest(array['core_team', 'executive', 'local_party_chair', 'candidate', 'support_team', 'member']::public.app_role[]) as r
on conflict (role, resource) do nothing;
insert into public.role_permissions (role, resource, can_read, can_write)
select r, 'policies', r in ('core_team', 'executive', 'local_party_chair', 'candidate'), r = 'core_team'
from unnest(array['core_team', 'executive', 'local_party_chair', 'candidate', 'support_team', 'member']::public.app_role[]) as r
on conflict (role, resource) do update set can_read = excluded.can_read;

create or replace function public.guard_core_permissions() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'core_team' and old.resource in ('dayplan_full', 'dayplan_volunteer', 'budget', 'volunteers_all', 'volunteers_add', 'stakeholders_all', 'stakeholders_add',
       'policies', 'social', 'coverage', 'visits', 'help_offer', 'help_inbox', 'mayor_todo', 'london_reports', 'london_media', 'links', 'stories')
     and (tg_op = 'DELETE' or not new.can_read or not new.can_write) then
    raise exception 'The core team always keeps the right to see, edit and delete this.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.guard_core_permissions() from public, anon, authenticated;
