-- LUCIEN > Economic policy: open official statistics (Nomis: Annual Population Survey, Claimant Count, ASHE, GDHI, Census 2021) in one long table,
-- so any figure can be cross-referenced by area, age and sex. Only the collector writes to it (through the ingest function); LUCIEN readers can read it.
create table if not exists public.econ_data (
  id              text primary key,                     -- a hash of dataset, area, sex, age, category, measure and period
  dataset         text not null,                        -- aps_labour | claimants | ashe | gdhi | census_econ
  geography_code  text not null,
  geography_name  text not null,
  geography_level text not null,                        -- uk | country | region
  sex             text not null default 'all',          -- all | male | female
  age_from        integer,                              -- null when the figure has no age breakdown
  age_to          integer,
  age_label       text,
  category        text not null,                        -- what is counted (Employed, Unemployed, ... / Claimants / GDHI)
  measure         text not null,                        -- Count, Median weekly pay - gross, ...
  unit            text not null,                        -- people | % | £ | hours | index
  value           numeric not null,
  period          text not null,                        -- as the source gives it ("Jul 2025-Jun 2026", "2021", "September 2026")
  source_url      text,
  fetched_at      timestamptz not null default now()
);
create index if not exists econ_data_lookup_idx on public.econ_data (dataset, geography_code, sex);
create index if not exists econ_data_period_idx on public.econ_data (dataset, period);
alter table public.econ_data enable row level security;
create policy econ_data_read on public.econ_data for select to authenticated
  using ((select public.is_admin()) or (select public.can('ulysse', 'read')));
