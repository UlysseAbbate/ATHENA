-- LOVELACE Stories: no box of a pitch is mandatory any more. The limits on length (and the three-line headline) stay; an empty box is simply empty.
alter table public.story_pitches
  alter column headline drop not null, alter column hook drop not null, alter column content drop not null, alter column turn drop not null, alter column cta drop not null,
  alter column media drop not null, alter column cost_estimate drop not null, alter column orgs_work drop not null, alter column set_piece drop not null;

do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.story_pitches'::regclass and contype = 'c' loop
    execute format('alter table public.story_pitches drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.story_pitches
  add constraint story_pitches_status_chk check (status in ('new', 'considering', 'used', 'declined')),
  add constraint story_pitches_headline_chk check (headline is null or (char_length(btrim(headline)) <= 300 and array_length(regexp_split_to_array(btrim(headline), E'\n'), 1) <= 3)),
  add constraint story_pitches_hook_chk check (hook is null or char_length(hook) <= 300),
  add constraint story_pitches_content_chk check (content is null or char_length(content) <= 1500),
  add constraint story_pitches_turn_chk check (turn is null or char_length(turn) <= 1000),
  add constraint story_pitches_cta_chk check (cta is null or char_length(cta) <= 600),
  add constraint story_pitches_media_chk check (media is null or (jsonb_typeof(media) = 'array' and jsonb_array_length(media) <= 12)),
  add constraint story_pitches_orgs_chk check (orgs_work is null or (jsonb_typeof(orgs_work) = 'array' and jsonb_array_length(orgs_work) <= 12)),
  add constraint story_pitches_link_chk check (briefing_link is null or briefing_link ~ '^https?://'),
  add constraint story_pitches_cost_chk check (cost_estimate is null or char_length(cost_estimate) <= 500),
  add constraint story_pitches_set_chk check (set_piece is null or set_piece in ('yes', 'no', 'not_sure'));
