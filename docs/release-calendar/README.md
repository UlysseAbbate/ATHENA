# Stats calendar (LUCIEN)

Upcoming and recently published data releases from UK public-sector bodies. It is the **Stats calendar** tab in LUCIEN (admin and anyone with LUCIEN access).

- **Collector**: `tracker/statscal.py`, called from `tracker/update.py`. Sources: ONS release calendar, GOV.UK statistics announcements and published statistics, London Datastore, data.police.uk, the London Assembly's meeting calendar (GLA modern.gov: meetings, agenda items, agenda packs and minutes), and an optional hand-kept file. Each source fails on its own: its last good records stay, it shows as failing in **Source health**, and the page shows a warning. See `SOURCES.md` for what each source returns.
- **When it runs**: 6am and 6pm London, with the other LUCIEN collectors ("Run everything" workflow). The **Refresh all data** button at the foot of any page runs it now.
- **Settings**: `config/statscal.yml` (which GOV.UK organisations, exclusions for the devolved administrations, windows). To add a body, add its GOV.UK organisation slug there.
- **Dates that no API gives** (TfL, Met, MOPAC): add them to `config/statscal_manual.yml` (format and examples in the file).
- **Change log**: each run records new releases, moved dates (old and new), cancellations and releases that have come out; 90 days are kept.
- **Calendar download**: made in the browser from the stored data. Confirmed and provisional dates only; "with estimates" adds estimated dates, marked `(est.)`.
- **Tests**: `python3 -m pytest -q tests/test_statscal.py` (offline, using recorded responses in `tests/fixtures/release-calendar/`); the page itself is covered by `node tests/ui/run.js`.

## Meetings (GLA)
`fetch_moderngov` reads the London Assembly's own democratic-services calendar (`https://www.london.gov.uk/about-us/londonassembly/meetings`, modern.gov) one month back to three ahead, and for meetings from 14 days ago to 45 days ahead it reads the meeting page for the numbered agenda items and links to the agenda, reports pack and minutes. Past meetings show as **Held**. It only reads where robots.txt allows. To add another modern.gov council, add it under `meetings:` in `config/statscal.yml`. TfL's board meetings (`board.tfl.gov.uk`) are on the same system but its robots.txt forbids bots, so they are not read.
