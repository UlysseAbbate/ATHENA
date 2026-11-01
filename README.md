# Athena

One static site (`site/`, hosted on Cloudflare) in front of one Supabase project (`ATHENA`, `fbsoibmtvapmxdlfdgxc`).

| Page | Who sees it | What it is |
|---|---|---|
| `/` | everyone | Home: one sign-in, then the programs you may open |
| `/lovelace/` | anyone with a role | **LOVELACE** (*London Organisation for Voters, Engagement, Liberalism, Action, Campaigns & Elections*): campaign workspace. Formerly *The Mall* (`/mall/` still redirects). |
| `/lucien/` | the admin, plus anyone given LUCIEN access | **LUCIEN** (*Letting You Catch Important Events & News*): policy tracker. Formerly *Ulysse* (`/ulysse/` still redirects). |
| `/access/` | the admin and program managers | Who can open what, at which level, until when; shared access codes |
| `/admin/` | the admin only | System status: collector health, failing sources, access ending soon, recent activity |

The plan for bringing LIBBY in and retiring shared passwords is in `docs/MASTER-PLAN.md`. All pages share one look (`site/shared/libby.css`, LIBBY's style) in light and dark; the header has an Auto/Light/Dark button.

**Every permission is enforced in the database** (row-level security). The pages only hide what the database would refuse anyway.

## Access model

- **Sign-in** is email + password (`site/shared/authui.js`). A new account sees nothing until someone with *Team & access* rights gives it a role.
- **Roles:** Core team, Executive, Local party chair, Candidate, Support team, Member. What each role may read or write is the `role_permissions` table, edited in *LOVELACE → Team & access*.
- **Time-limited access:** each person can have an *Access until* date. After it, `my_role()` returns nothing and they see nothing until it is extended.
- **Guard rails (in the database, not the page):**
  - Nobody can change their own role or access date.
  - Only the core team can grant or remove core-team access.
  - Nobody but the admin can change the admin's account.
  - The core team's own *Team & access* rights cannot be switched off, so nobody can lock everyone out.
  - Only the admin can open LUCIEN to a role.
  - Profiles: only role, name and access date can be changed through the API.
- **Admin** = the account whose confirmed email is `ulysse.abbate@gmail.com`, hardwired in the database function `admin_email()` (migration `20261027120000_hardwire_admin_email.sql`). No table row can make anyone else the admin; to change it, a new migration is needed. `is_admin()` is checked in Postgres. The admin can do everything and always holds each program's top level (for LIBBY, Developer).
- **Least privilege:**
  - Anonymous visitors have no table rights at all.
  - Signed-in users cannot `TRUNCATE`, and cannot see the admin tables.
  - Permission checks run once per query (fast RLS).
- **Activity log:** every insert, update and delete in LOVELACE is recorded in `audit_log`: who, when, which table, which fields. Values are not recorded. Readable by roles with *Activity log* (core team by default) and shown on *Team & access* and `/admin/`.
- **Edit conflicts:** rows carry `updated_at`/`updated_by` (set by the database). An edit only saves if nobody changed the row since it was opened; otherwise the page says so and reloads it.
- **Security headers** (`site/_headers`):
  - A strict Content-Security-Policy: scripts only from this site, data only from the Athena Supabase project.
  - No framing, and `noindex`.
  - No inline scripts anywhere.

The full schema is in `supabase/migrations/` and the ingest function in `supabase/functions/ulysse-ingest/`. Both are already applied to the live project; the files are the record.

## How people get in

1. **Athena sign-in** (one account for everything). A new account sees nothing and is told it is waiting for the administrator.
2. **The home page** shows only what the account may open: LOVELACE, LUCIEN, LIBBY, and, for the administrator (`ulysse.abbate@gmail.com`) and any program manager the administrator appoints, **Access**; **Admin** is the administrator's alone.
3. **Access** (`/access/`): the administrator starts on **Everyone**: every account that has been made, newest first, with a level to choose for **LOVELACE, LUCIEN and LIBBY** on the one row ("No access" removes it; an optional end date sits under each level; accounts with nothing yet are counted as waiting). A tab for each program shows that program's people, managers and shared codes. LOVELACE is given here like the others: the grant sets the person's role and end date (the database copies it onto their profile, which LOVELACE's screens read); LOVELACE → Team & access still sets what each role can do. A program manager (for example LOVELACE's core team) sees only their own program's tab.
4. **LIBBY** opens on a gate with two buttons, shown to everyone signed in: **Beta test** (the Data page; opened by the shared beta code, which is then kept on the person's account) and **Developer** (everything, including work in progress; only the administrator can open it). *Beta / Developer* in the page footer comes back to the gate. The beta code is made like any shared code (Access → LIBBY → Access codes, level *Beta tester*) and is stored only as a hash.

## Tables

Every table on the site gets, from `site/shared/tables.js` and `tables.css`: a **filter arrow on each column title** (a list of the column's values with a search box, as in Excel or Google Sheets), **sorting**, and a **title row that stays at the top** while you scroll. A "Filtered: showing 3 of 12 rows" line with *Clear filters* appears while a filter is on, and LOVELACE's CSV download follows it. Add `data-nofilter` to a `<table>` to leave it alone.

## LOVELACE (formerly The Mall)

**Pages:**
- **Overview:** the campaign plan for this week in a clean read-only layout, by the five headings (Main News, Across London, Campaigning, Media, Internal Actions), with a button to *This Week*.
- **This Week** (the campaign plan): day and week views, under five headings: **Main News**; **Across London** (Constituency Activity, one section for each of the 14 GLA constituencies plus one for several; and Local Party Activity, where the visit requests sit); **Campaigning** (Mayoral Activity, Action Days, Other Events); **Media** (Parliamentary News, GLA News, Council News, Media Activity; the three news sections show the latest coverage of their topic and link to the Media page); **Internal Actions** (Executive, Campaigns Committee, Governance, Membership, Candidates). Local party visits sit on their dates under Local Party Activity; visits with no date yet are listed under "Local party visit requests". Constituency sections and Local Party Activity can be edited by local party chairs and above (the *Edit the Constituency Activity sections* row of the permissions grid).
- **Budget & governance**
- **Volunteers & stakeholders:** one list (Full name, Organisation, Sector, Email, Phone, Point of contact, Notes). Volunteers are filed under Lib Dems. Anyone allowed to add can add; only the full-list roles see everyone's.
- **Policies**
- **Media:** two sections. **Overall Media** is wider political news (Parliament, GLA, council; give a story a topic and it shows on *This Week*). **Lib Dem Media** is the news about us and the tracked accounts' posts, found automatically at 6am and 6pm (social posts show the platform as the outlet and the first line of the caption as the headline), plus the tracked accounts.
- **Team & access** (the administrator's alone, as on LUCIEN and LIBBY): people, roles, access dates, last sign-in, the permissions grid and recent activity. On LUCIEN and LIBBY the same page (`site/shared/teampage.js`) lists people, levels, access codes and recent access changes.

**What every table has:**
- search
- click-to-sort columns
- **CSV** download of what is shown
- "Last edited …" in each edit form

Pages refresh themselves when you come back to the browser tab, so you see other people's changes.

**The Media page fills itself** at 6am and 6pm (London):
- **News:** the collector reads the media outlets' RSS feeds and adds any story naming Sarah Olney, first by headline and standfirst, then by opening each story from the last two days and looking for her name in the article text (up to 400 pages a run; robots.txt is respected). These are marked *auto*.
- **Social posts:** it reads the accounts listed under *Tracked accounts* (London Lib Dems, London Young Liberals, Sarah Olney MP, Hina Bokhari AM, City Hall Lib Dems), but only where a platform allows it: **BlueSky** (public API) and **Substack** (RSS). Put the handle in the account's row and the next run picks it up.
- **Instagram, Facebook, X, TikTok and LinkedIn** have no open feed and forbid scraping, so they are not read automatically; add their posts by hand, or connect an approved API later.
- Duplicates by URL (and, for news, outlet + headline) are skipped. Anything else can still be added by hand.

## LUCIEN (policy tracker, formerly Ulysse)

Refreshed automatically at 6am and 6pm London time by GitHub Actions (`.github/workflows/update.yml`, or *Run workflow* by hand). It tracks:

1. **Select committees:** reports, special reports and government responses (Parliament Committees API).
2. **Think tanks:** ~63 organisations in `config/sources.yml`.
3. **Lib Dems in the media:** each outlet's own RSS feeds, filtered to stories whose headline or standfirst is about the party.
4. **Political polling**, only specific polls and reports (no generic voting-intention averages or Wikipedia tables):
   - the pollsters' own sites (~30) and polling analysts, through the same self-healing collector as the think tanks;
   - YouGov's article pages and News Tracker;
   - a political-only filter.

**Using it:**
- **Filters:** policy area, geography, type, source, House, date range and read/unread. Each dropdown counts only what the other filters leave.
- **Read state** is per person and syncs across devices.
- The page remembers your last tab and filters, and counts what arrived **since your last visit** (with a filter to show only those).
- `/` jumps to search.
- The *Updated …* label turns black if the data is more than 15 hours old.

### Respecting sites (robots.txt, rate, terms)

- **Every request checks the site's robots.txt first** (`fetch()` in `tracker/update.py`).
  - A disallowed URL is never fetched.
  - A robots.txt that answers 401/403, 5xx or not at all means "no bots"; a missing robots.txt (404) means allowed (RFC 9309).
  - Source health says which applied ("blocked by robots.txt", "site refuses bots", "site unreachable").
- **Requests to one site are at least 1 second apart.** A site's `Crawl-delay` is honoured, up to 30 seconds.
- Nothing requires a login and nothing gets around a paywall.
- **Google News is not used.** Its robots.txt forbids bots from its RSS feeds. Media comes from outlets' own feeds.
  - If an outlet's configured feeds fail and it has a `url:`, the feeds that page advertises are tried.
  - Outlets with no open feed, or whose robots.txt refuses bots (Express and Lib Dem Voice, from GitHub's runners), show as failing in Source health rather than being fetched another way.
- A site that answers with an empty page (a bot check) is reported as such, and not worked around.

### How a think tank or pollster is collected (`collect_source`)

1. Explicit `feed:`/`feeds:`.
2. The main page (its `www`/bare-host twin only if the site did not answer): feeds it advertises and common feed paths (a feed must have at least 3 entries), then a scrape of the listing, then **data built into the page** (Next.js/JSON-LD), the **WordPress REST API** and **Squarespace `?format=json`**.
3. **The site's XML sitemap** (advertised in robots.txt for crawlers): its most recently modified pages under the organisation's own path.
   - Topic, series and collection pages are skipped.
   - A university-wide sitemap is never used.
   - A sitemap with no dates is read from its end; `sitemap_days` widens the window and `sitemap_pattern` says which addresses are publications (IIED's are `/12345iied`).
   - The title comes from the URL until the page is read; a later run replaces it with the page's real headline and publication date.
   - Until then, such an item is not marked NEW: a sitemap date is when a page last changed, which for an old report can be yesterday.

`feed: false` skips feeds, `sitemap: false` skips the sitemap. `urls:` lists other addresses, tried only if the main one gave nothing. Source health shows the method used and why earlier steps failed.

### Data and state

- The collector reads the previous run's data **from the database** (through the `ulysse-ingest` function) and uploads the new data there. First-seen times and dates learned earlier are kept.
- If the database cannot be read, the run fails instead of starting from nothing.
- Nothing is committed back to the repo; `data/` is a local working copy only (git-ignored).
- **Needed once:** the same random value (24+ characters) in the Supabase Edge Function secret `INGEST_TOKEN` and the GitHub Actions secret `INGEST_TOKEN`.

**Run locally** (without the secrets, `data/ulysse/` is used and nothing is uploaded):

```bash
pip install -r requirements.txt
python tracker/update.py                 # everything
python tracker/update.py media polling   # some groups: committees | thinktanks | media | polling
python tracker/update.py reclassify      # re-apply config/taxonomy.yml to stored items, no collecting
cd site && python -m http.server
```

### Categories, dates, polling types

- **Categories:**
  - Assigned from `config/taxonomy.yml`: policy areas, geographies, types and drop patterns.
  - Stored items are re-classified every run.
- **Publication dates:**
  - Taken from the feed or listing, the URL, or the article page itself (up to 40 pages per run).
  - Items whose source never states a date are grouped as "Date not shown by the source".
- **Polling:**
  - Only political polling is kept: `polling.political` in `config/sources.yml`, applied retroactively too.
  - Types: voting intention, MRP / seat projection, leader ratings, preferred PM, policy opinion.

## LIBBY (under `/libby/`)

Formerly its own site. Code: `site/libby` (pages), `functions/api/libby` (server routes), `lib/libby` (helpers), `scripts/libby` (jobs and checks);
how the Whips' Office tools work is in `docs/libby/README.md`, and how to add a page in `docs/libby/adding-a-page.md`. It signs in through Athena
(email + password, or a shared access code), and a person's LIBBY level (Peer, Whip, Spokesperson, Leader's office, Staff, Admin) is a row on the
Access page. Server routes need these Cloudflare Pages secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `SESSION_SECRET`,
`ANTHROPIC_API_KEY`. The steps to bring it live are in `docs/PHASE-4-GO-LIVE.md`.

**Two Houses.** LIBBY opens on a choice of House, before Beta / Developer: **Honourable LIBBY** (the House of Commons, green) and **Noble LIBBY** (the House of Lords, red: everything LIBBY had before). Honourable LIBBY has the Commons counterparts, from the Commons APIs: *Today* and each day (What's On: the Chamber, Westminster Hall, the general and select committees, with Lib Dem MPs marked), *Legislation* (the live Commons Bills; each Bill's page shows the amendments at the Commons Committee and Report stages, with Lib Dem MPs marked, and the Voting / C / NC / Comment buttons), *Business* (*Coming up*: the next four weeks; *Past*: Commons divisions with how the Lib Dem MPs voted, Commons written questions and statements, committees, Hansard) and *Policy*. The Lords Whips' Office pages (Comms, Whips, Wallace Room, Roles, Advisers, the drafting tool) and the Lords voting analysis have no Commons counterpart and are left out. Pages belong to a House through `house` in `site/libby/js/pages.js`; the Commons routes are under `functions/api/libby/commons/`. *Commons / Lords* in the page footer goes back to the choice.

**Three editions, one site.** The edition a person sees is their LIBBY level, set on the Access page:
- **Live:** Peer, Whip, Spokesperson, Leader's office, Staff, Admin, as before.
- **Beta test:** the *Beta tester* level (can also be a shared code). They see only the **Data** page, read-only (more pages are added to the beta by marking them `beta: true`); the menu, the pages and the server all enforce it, so other addresses and routes are refused.
- **Developer:** the *Developer* level, above Admin, which only the admin can give (you always have it). It adds the **Developer** page (a register of every page and who can open it) and any page marked `level: DEVELOPER` in `site/libby/js/pages.js`, for work in progress. Mark a page `beta: true` to show it to beta testers.

## Checks

`.github/workflows/checks.yml` runs on every pull request and push to main (LIBBY's own checks run in `libby-check.yml`):
- pyflakes and offline collector tests (`tests/test_collector.py`)
- JavaScript syntax
- **database rules** (`tests/db/run.sh`): every migration applied to a throwaway Postgres, then who may grant what to whom, access codes, expiry, audit
- **design tokens** (`tests/contrast.js`, `tests/libby-css.js`): WCAG contrast of every colour pair in light and dark, and no fixed colours in LIBBY's stylesheet
- browser tests (`tests/ui/run.js`): every page as admin, core team, member and a LUCIEN manager against a mocked database, under the real security headers,
  in both themes, failing on any console error or CSP violation

```bash
pip install -r requirements.txt -r requirements-dev.txt && python -m pytest -q tests
node tests/contrast.js && node tests/libby-css.js
bash tests/db/run.sh        # needs Postgres installed locally
node tests/ui/run.js        # needs Playwright
node scripts/libby/check-site.mjs && node scripts/libby/check-access.mjs && node scripts/libby/check-list.mjs
```

## Settings to switch on in the Supabase dashboard

- **Authentication → Providers → Email → Leaked password protection** (checks new passwords against known breaches; on paid plans).
- **Authentication → URL Configuration:** *Site URL* and *Redirect URLs* = the deployed address, so password-reset links come back to the site.
- **Authentication → SMTP:** a custom sender for real use (the built-in one sends only a few emails per hour).
