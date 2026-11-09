# Release calendar: sources (Phase 0 probe)

Probed live on 2026-11-09 from the build sandbox. Trimmed real responses are in `tests/fixtures/release-calendar/`. No source needed a key. Everything below is what the live APIs returned, not what the brief assumed.

## Summary

| Source | Forward dates | Just published | Working endpoint | Key |
|---|---|---|---|---|
| ONS release calendar | Yes (confirmed + provisional) | Yes | `https://api.beta.ons.gov.uk/v1/search/releases` | No |
| GOV.UK statistics announcements | Yes (confirmed + provisional + cancelled) | Yes (via Search API) | `https://www.gov.uk/api/search.json` | No |
| London Datastore (GLA) | No | Yes | `https://data.london.gov.uk/api/action/package_search` (CKAN-style) and `/data.json` (DCAT) | No |
| data.police.uk | No | Yes (monthly) | `https://data.police.uk/api/crime-last-updated`, `/crimes-street-dates` | No |
| Metropolitan Police / MOPAC | No machine-readable calendar | Via the two above (Met data is inside data.police.uk) | none | n/a |
| TfL | No dates in the Unified API | No | `https://api.tfl.gov.uk` works but has no release dates | No (for what we use) |

## Where the brief's leads were wrong or needed correcting

1. **ONS base URL**: `https://api.beta.ons.gov.uk/v1/search/releases` works. `/v1/releases` is a 404. The `release-type` values `type-upcoming`, `type-published`, `type-cancelled` are right.
2. **ONS field names are different from the Go client's**: dates are not at the top of the object. A release is `{ uri, date_changes, description: { title, summary, release_date, published, cancelled, finalised, postponed, census, provisional_date? }, highlight }`. There is **no** `cancellation_notice` in any record seen, and no `contact` or `national_statistic`. `provisional_date` only exists on provisional records and is free text such as `"23 July 2027 7:00am"`.
3. **ONS `date_changes`** is a list of `{ change_notice, previous_date }` (no `changed_at`). It is `null` when nothing has changed. 10 of the 401 upcoming releases carried it.
4. **ONS timestamps are UTC with a `Z`** and are the real instant: `2027-07-23T06:00:00.000Z` is 07:00 BST. In winter they read 09:30Z = 09:30 GMT. Convert to Europe/London for the date; never trust the `Z` date alone (a 00:30 BST release would be the previous UTC day).
5. **ONS pagination**: `limit` (tested to 100) and `offset` work. The response has a `breakdown` block (`total`, `provisional`, `confirmed`, `published`, `cancelled`) and `took`. Total upcoming is about 400, so four pages. `fromDate` / `toDate` (YYYY-MM-DD) filter by date and `sort=release_date_asc` works on published. Cancelled has 323 records back to 2016, so always pass `fromDate`.
6. **GOV.UK document type**: the content is `format: statistics_announcement` (filter with `filter_format=statistics_announcement`). The search facet `content_store_document_type=upcoming_statistics` returns 0 results. On the Content API the document type is `official_statistics_announcement` (also `national_statistics_announcement`).
7. **GOV.UK state field**: `statistics_announcement_state` in search results, `details.state` in the Content API. Values seen: `confirmed`, `provisional`, `cancelled`. Counts for the whole index: about 7,900 announcements.
8. **GOV.UK dates**: `release_timestamp` in search is good for current announcements (`2026-11-10T09:30:00.000+00:00`). Some old ones are corrupt (`0020-04-19T…`), so always filter with `filter_release_timestamp=from:YYYY-MM-DD`. A provisional announcement with only a month uses the **last instant of the month** (`2027-05-31T23:59:59.000+01:00`): that is how to detect `date_precision: month`. The Content API's `details.display_date` carries the human text ("November 2026 (provisional)").
9. **GOV.UK has no `previous_display_date` / `cancelled_at` in the search results.** They would have to come from the Content API per announcement (not probed beyond `details.{display_date, release_timestamp, state, format_sub_type, document_type_label}`; one call per announcement is a lot, so see "Decisions"). The Content API record shows `details` has no change history in the example fetched.
10. **GOV.UK covers devolved bodies**: the organisation facet includes `northern-ireland-statistics-and-research-agency` (482 announcements) and `the-scottish-government` (214), so `config/sources.yml` needs the exclusion list the brief expects. Many organisation slugs are historic (e.g. `ministry-of-housing-communities-and-local-government-2018-2021`), so slugs must be taken from the live facet, not guessed. The facet lists 115 organisations; the fixture has them all.
11. **GOV.UK 1,500 cap and ONS overlap**: the upcoming list for 2026-11-09 onwards is 1,821 announcements, over the cap, so per-organisation queries (or per-date-window queries) are needed. ONS is the largest organisation (909 announcements) and appears in GOV.UK too: dedupe preferring the ONS API record.
12. **London Datastore**: the `/api/3/action/...` path redirects (307, HTML meta refresh) to `/api/action/...`; use the latter. It is CKAN-shaped (`package_search`, `package_list`) and works without a key. **No update-frequency field exists** in either the CKAN package or `data.json` (no `accrualPeriodicity`, none in any of the 1,309 datasets), and `data.json` does not list a next-update date. So estimates must come from our own history. Also: **`organization` is `"(none)"` on every dataset**, so the publisher has to come from `maintainer` / `author` (seen: `GLA`, `GLA Planning Support`, MPS) or a title prefix ("MPS …"). `package_search` with default rows returns all 1,309 packages and 10 MB: always pass `rows`/`start`. `data.json` is 3 MB, has `modified`, `issued`, `landingPage`, `publisher.name`, `theme`, and is the cheaper way to get everything in one request. `metadata_modified` is when the *record* changed, which includes fixes and added files, not only new data.
13. **DataPress docs** (`datapress.com/docs/api`) return a JS app shell, not readable content; the CKAN-style endpoint is the working route, so no DataPress-specific client is needed.
14. **data.police.uk**: `crime-last-updated` returns `{"date": "2026-09-01"}`. `crimes-street-dates` returns 36 months, newest first, each with a `stop-and-search` list of force ids. The Met's force id is `metropolitan` (`/api/forces/metropolitan` works), but **`metropolitan` is not in the current `stop-and-search` list for 2026-09**: the Met is absent from stop-and-search availability this month. The dataset is the latest month only (about two months behind the calendar), so no forward date. Rate limit (docs): **15 requests per second, burst 30**, 429 beyond that. No key.
15. **Met / MOPAC**: no machine-readable forward calendar was found; their recorded crime and stop-and-search data are in data.police.uk and also on the London Datastore (e.g. "MPS Monthly Crime Dashboard Data", "MPS Recorded Crime: Geographic Breakdown", "MPS Custody …" were all in the first page of `package_search`). **Decision: the Met is covered by (a) police.uk and (b) London Datastore datasets whose maintainer/title is MPS/MOPAC; anything else goes in `manual_events.yml`.**
16. **TfL**: `https://api.tfl.gov.uk/` works (e.g. `Line/Mode/tube/Status` returned 200) but carries live operations, not release dates, as the brief said. The transparency/FOI pages on `tfl.gov.uk` return **HTTP 403** to automated requests (an "Error" page), so the schedule cannot be fetched or parsed. **Decision: manual only** (`manual_events.yml`). I did not try to get round the block.
17. **api.gov.uk** is a catalogue of about 230 APIs. There is no machine-readable list (HTML only). Candidates from a scan, none probed beyond the catalogue entry (the hosts are not in the sandbox's allowed list, and being listed does not mean open access):

   | Catalogue entry | Relevant to | Recommendation |
   |---|---|---|
   | `/dfe/explore-education-statistics-api/` (DfE Explore education statistics API) | statistics | Check in Phase 1 whether it exposes publication release dates; GOV.UK already announces DfE statistics, so low priority. |
   | `/ons/statistics/` (ONS "Statistics") | statistics | Same API family as the release calendar; no new source. |
   | `/hmrc/bulk-data-file-list/` (HMRC) | published data | Skip: it lists bulk tax files, not statistics releases. |
   | `/ukp/police-api/` | police | Already used (data.police.uk). |
   | `/tfl/transport-for-london-unified-api/` | London transport | Already checked: no release dates. |
   | `/dft/…naptan…` | transport reference data | Skip: reference data, not a release calendar. |
   | `/gds/data-gov-uk/` | data discovery | Possible later: data.gov.uk may list "last updated" for datasets; skip for now. |
   | `/mhclg/planning-and-housing-data-in-england-…` | planning data | Skip for now. |
   | `/nd/…` (NHS England / NHS Digital APIs) | health | Skip: operational APIs. NHS England statistics are already announced through GOV.UK (NHS England has 524 announcements). |

## Licence

ONS and GOV.UK content is under the Open Government Licence v3.0. Police API data is under the OGL v3.0 (stated on data.police.uk). London Datastore datasets have a per-dataset `license` (the `data.json` entries seen have `license: null`; the CKAN packages carry `license_title`), mostly UK Open Government Licence, but **each dataset differs**, so the page links out and does not copy data. To be confirmed per source in Phase 1.

## Fields that will be mapped

- **ONS**: `uri` → id/url (`https://www.ons.gov.uk` + uri), `description.title`, `description.summary`, `description.release_date` (→ date in Europe/London, and the time), `description.finalised` (false → `provisional`), `description.provisional_date` (text, used for month/quarter precision), `description.cancelled`, `description.published`, `description.postponed`, `date_changes[]` → `previous_dates`.
- **GOV.UK**: `link` → url, `title`, `organisations[].title/link`, `release_timestamp`, `statistics_announcement_state`, `display_type` (e.g. "Official Statistics", "National Statistics", "Accredited official statistics") → `official_status`. Published items: `public_timestamp`, `link`, `title`, `organisations`.
- **London Datastore**: `landingPage`, `title`, `modified`, `issued`, `publisher.name`/maintainer, `theme`.
- **police.uk**: `crime-last-updated.date`, `crimes-street-dates[].date`.

## Decisions I need from you (see the report)

1. **Where it lives.** The brief assumes a standalone GitHub Pages repo. You asked for a LIBBY page, so I propose: the Python fetchers run in a GitHub Action (a new job in "Run everything", at 6am and 6pm) and write the results to the Supabase `api_snapshots` table (as the other LIBBY data does); the page reads them through a `/api/libby/…` route. Committing JSON to `data/` and serving it from the repo remains possible but does not fit the access system (the page would be public).
2. **Package name**: the brief says `python -m calendar.run`, but a package called `calendar` shadows Python's standard library `calendar`, which breaks other libraries. I'll call it `releasecal`.
3. **Cadence**: the brief says twice daily around 10:43 and 16:43 UTC; the site's updates run at 6am and 6pm. I'll use the 6am/6pm run unless you want the brief's times (ONS publishes at 07:00 and 09:30, so a 6pm run misses same-day items until the next morning).
