-- econ_data: a display label for a point in a time series ("2026 JUN-AUG"), next to its sortable period ("2026-07"). Used by the ONS headline series.
alter table public.econ_data add column if not exists label text;
