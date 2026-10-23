# Athena

`site/` is published as one static site with a two-button home page:

- **ULYSSE** (`site/ulysse/`): the Policy Tracker described below.
- **THE MALL** (`site/mall/`): *Mayoral Analysis for London's Liberals*, a members-only campaign workspace. See [The Mall](#the-mall).

# Policy Tracker (Ulysse)

A static site, refreshed every three hours by GitHub Actions, that tracks:

1. **Select committees**: new reports, government responses and special reports from all Commons and Lords committees (Parliament Committees API).
2. **Think tanks**: new outputs from the ~64 organisations in `config/sources.yml`. For each one the collector tries, in order: an explicit `feed:` URL, RSS/Atom autodiscovery and common feed paths, then a generic scrape of the publications page.
3. **Lib Dems in the media**: Telegraph, Times, Guardian, Politico, FT, Economist and others, via per-outlet Google News RSS searches (keywords are in the config).
4. **Polling**: a voting-intention chart and table (from the Wikipedia table of BPC-member polls) plus new write-ups and trackers from BPC member firms, tagged *voting-intention*, *party-support* or *news-cycle*.

"NEW" means first seen in the last 48 hours (and not an old backlog item). `data/ulysse/feed.json` is committed back to the repo each run, which is how first-seen times persist.

## Setup

1. Create a GitHub repo and push this folder to `main`.
2. Settings → Pages → Source: **GitHub Actions**.
3. Actions → *Update tracker and deploy* → Run workflow.
4. Open the site and check the **Source health** tab. Committees, media and polling were verified against live responses on 2026-10-23. Only ~14 of the 63 think tank entries were verified live (the verification sandbox could not reach the rest), so expect some to need a corrected URL or a `feed:` override in `config/sources.yml` (`feed: false` forces the HTML scrape instead of feed autodiscovery).

Run locally:

```bash
pip install -r requirements.txt
python tracker/update.py            # everything
python tracker/update.py media      # one group: committees | thinktanks | media | polling
cd site && python -m http.server    # then open http://localhost:8000
```

## Known limitations

- Committees: only Report, Special Report and Government Response publications are kept (`keep_types`). Correspondence was ~70% of the API's volume, add `"correspondence"` to include it. Committee links point at `committees.parliament.uk/publications/<id>/` (the site's standard pattern; not fetched during verification).
- Media: Google News RSS matches keywords anywhere in an article, so results are filtered to headlines matching `media.title_pattern`. Only headlines and Google redirect links are available (no article text), and a quiet outlet shows as "quiet" in Source health, not as a failure. Daily Mail, Spectator and Reuters returned nothing from Google News.
- Polling: the Wikipedia parser assumes the first table is the current year (the table gives no year in its date column), keeps GB/UK rows only and tags MRPs (excluded from the chart). Several smaller firms (Techne, BMG, JL Partners, Deltapoll, Verian, Whitestone, Merlin, Stonehaven) are only sparsely indexed by Google News. YouGov News Trackers are collected from the YouGov articles page plus the earlier editions linked from the newest one.
- Bright Blue and the IFS return HTTP 403 to all automated requests (including robots.txt); they are left in the config and will show as failing.
- HTML-scrape fallbacks are heuristic; add a `feed:` where one exists.
- If any site's terms forbid automated access, remove it from the config.

## Next steps

The "London" site can reuse `tracker/update.py` and the front end: add a new `london` config block (London media outlets, GLA and borough sources) and a tab.

## The Mall

A sign-in-protected campaign workspace modelled on the campaign Google Sheet. It is a static front end (`site/mall/`) talking to a Supabase project (Postgres + Auth). **All permissions are enforced by row-level security in the database**, not by the page: a hidden tab is a convenience, the database decides what each role can read or write.

**Roles:** Core team, Executive, Local party chair, Candidate, Support team, Member. New sign-ups (email magic link) see nothing until a core team member assigns a role in *Team & access*. What each role may do is a table (`role_permissions`) editable on that same page; the shipped defaults are placeholders.

**Pages:** Campaign plan (day and week views; only the six shared rows are visible to every role), Local party visits, Budget & governance, Volunteers (anyone can add, only core/executive see all), Policies, Social media (accounts grid, outputs log, content pipeline), Coverage, Stakeholders (extends the media list; anyone can add), Team & access.

**Backend:** Supabase project `ATHENA` (`fbsoibmtvapmxdlfdgxc`). The publishable key in `site/mall/config.js` is public by design. The schema and policies were applied as a migration (`mall_schema_roles_rls`). The first core-team account is whichever email is listed in `bootstrap_admins`. `site/mall/vendor/` holds a pinned copy of `@supabase/supabase-js` so the sign-in page loads no third-party scripts.

**One-time setup in Supabase** (Authentication → URL Configuration): set *Site URL* and add *Redirect URLs* for the deployed address (e.g. `https://<user>.github.io/<repo>/mall/`), or magic links will not return to the site. For real use, configure a custom SMTP sender (Authentication → SMTP): the built-in mailer is limited to a few emails per hour.

**Data:** the sheet's contents were loaded into the database, not committed to this repo (they include names, phone numbers and emails).

## Admin and privacy

- `/admin/` is an owner-only dashboard (links to Ulysse and the Mall, plus counts). Anyone who is not the admin sees "Not found".
- **Admin = the confirmed email in the `admins` table** (`ulysse.abbate@gmail.com`). The check is `public.is_admin()`, enforced in Postgres. The admin has full access to the Mall (`can()` always returns true) and nobody else can change the admin's role.
- **Ulysse is admin-only.** Its data no longer ships with the site: the collector writes `data/ulysse/*.json` (private repo, used for first-seen timestamps) and uploads it through the `ulysse-ingest` Edge Function into `public.ulysse_data`, which only the admin can read. The ULYSSE button on the home page appears only after the admin signs in.
- **Needed once:** the same random value (24+ characters) stored as the Supabase Edge Function secret `INGEST_TOKEN` and the GitHub Actions secret `INGEST_TOKEN`. Until then uploads are rejected and Ulysse shows no data.

## Ulysse categories, dates and read state

- **Categories** are assigned at collection time from `config/taxonomy.yml` (keyword rules plus per-source defaults, all editable): up to 2 **policy areas** (20 areas), up to 2 **geographies** (UK nations, London, English regions, and international regions), and a **type** (committee report / special report / government response, think-tank report, briefing, response, article, poll type, news coverage). Committees also carry their **House**. The rules are heuristics, so expect the occasional miss; tune `taxonomy.yml` and re-run (all stored items are re-classified each run, or run `python tracker/update.py reclassify` for a no-network re-classification).
- **Staff bios, job adverts and housekeeping pages** picked up by the generic scraper are dropped (`drop_title_pattern`, `drop_summary_pattern` in the taxonomy).
- **Publication dates** are shown on every item. If a listing gives none, the collector tries the date in the URL, then the article page's own metadata (up to 40 pages per run, polite 1s delay, up to 3 tries each). Items whose source never states a date are grouped as "Date not shown by the source" with the date first seen.
- **Read / not read** is a per-item toggle stored in the admin-only `ulysse_read` table (row-level security), so it syncs across your devices. Filter by Unread / Read, or "Mark all shown as read".

## How think-tank collection copes with awkward sites

For each organisation the collector tries, in order: explicit `feed:`/`feeds:` -> the page (and its `www`/bare-host twin, plus any `urls:` alternates) -> feed autodiscovery and common feed paths -> a scrape of the listing page -> finally a Google News search restricted to the organisation's own domain (`site:`), which is how sites that block automated requests (HTTP 403) or render with JavaScript still get tracked. Google News items are headlines and redirect links only. A feed is only trusted if it has at least 3 entries. `feed: false` skips feeds, `news: false` disables the Google News fallback, and `news_query:` overrides its search. The **Source health** tab shows which method each source used and why earlier attempts failed.
