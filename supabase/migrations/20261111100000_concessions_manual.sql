-- Concessions that were not won through a tracked amendment (for example the Staff's own sheet, imported from a spreadsheet).
-- They have no Bill/stage/amendment on bills.parliament.uk, so bill_id and stage_id are 0 and amendment_id comes from this sequence.
create sequence if not exists public.concessions_manual_seq start 1000000;
alter table public.concessions alter column amendment_id set default nextval('public.concessions_manual_seq');
alter table public.concessions add column if not exists name text;      -- what the concession is called, e.g. "Decent Homes Standard"
alter table public.concessions add column if not exists period text;    -- when it was won if only the season is known, e.g. "Summer 2025" (shown instead of a precise date)
alter table public.concessions add column if not exists manual boolean not null default false;
