# Stats calendar (LUCIEN)

Upcoming and recently published data releases from UK public-sector bodies. It is the **Stats calendar** tab in LUCIEN (admin and anyone with LUCIEN access).

- **Collector**: `tracker/statscal.py`, called from `tracker/update.py`. Sources: ONS release calendar, GOV.UK statistics announcements and published statistics, London Datastore, data.police.uk, and a hand-kept file. Each source fails on its own: its last good records stay, it shows as failing in **Source health**, and the page shows a warning. See `SOURCES.md` for what each source returns.
- **When it runs**: 6am and 6pm London, with the other LUCIEN collectors ("Run everything" workflow). The **Refresh all data** button at the foot of any page runs it now.
- **Settings**: `config/statscal.yml` (which GOV.UK organisations, exclusions for the devolved administrations, windows). To add a body, add its GOV.UK organisation slug there.
- **Dates that no API gives** (TfL, Met, MOPAC): add them to `config/statscal_manual.yml` (format and examples in the file).
- **Change log**: each run records new releases, moved dates (old and new), cancellations and releases that have come out; 90 days are kept.
- **Calendar download**: made in the browser from the stored data. Confirmed and provisional dates only; "with estimates" adds estimated dates, marked `(est.)`.
- **Tests**: `python3 -m pytest -q tests/test_statscal.py` (offline, using recorded responses in `tests/fixtures/release-calendar/`); the page itself is covered by `node tests/ui/run.js`.
