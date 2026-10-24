# Athena

One static site (`site/`, hosted on Cloudflare) in front of one Supabase project (`ATHENA`, `fbsoibmtvapmxdlfdgxc`).

| Page | Who sees it | What it is |
|---|---|---|
| `/` | everyone | Home: lists the workspaces the signed-in person may open |
| `/mall/` | anyone with a role | **The Mall** (*Mayoral Analysis for London's Liberals*): campaign workspace |
| `/ulysse/` | the admin, plus any role the admin opens it to | **Ulysse**: policy tracker |
| `/admin/` | the admin only | System status: collector health, failing sources, access ending soon, recent activity |

**Every permission is enforced in the database** (row-level security). The pages only hide what the database would refuse anyway.

## Access model

- **Sign-in** is email + password (`site/mall/authui.js`). A new account sees nothing until someone with *Team & access* rights gives it a role.
- **Roles:** Core team, Executive, Local party chair, Candidate, Support team, Member. What each role may read or write is the `role_permissions` table, edited in *The Mall → Team & access*.
- **Time-limited access:** each person can have an *Access until* date. After it, `my_role()` returns nothing and they see nothing until it is extended.
- **Guard rails (in the database, not the page):**
  - Nobody can change their own role or access date.
  - Only the core team can grant or remove core-team access.
  - Nobody but the admin can change the admin's account.
  - The core team's own *Team & access* rights cannot be switched off, so nobody can lock everyone out.
  - Only the admin can open Ulysse to a role.
  - Profiles: only role, name and access date can be changed through the API.
- **Admin** = the account bound in the `admins` table (`ulysse.abbate@gmail.com`). `is_admin()` is checked in Postgres. The admin can do everything.
- **Least privilege:**
  - Anonymous visitors have no table rights at all.
  - Signed-in users cannot `TRUNCATE`, and cannot see the admin tables.
  - Permission checks run once per query (fast RLS).
- **Activity log:** every insert, update and delete in the Mall is recorded in `audit_log`: who, when, which table, which fields. Values are not recorded. Readable by roles with *Activity log* (core team by default) and shown on *Team & access* and `/admin/`.
- **Edit conflicts:** rows carry `updated_at`/`updated_by` (set by the database). An edit only saves if nobody changed the row since it was opened; otherwise the page says so and reloads it.
- **Security headers** (`site/_headers`):
  - A strict Content-Security-Policy: scripts only from this site, data only from the Athena Supabase project.
  - No framing, and `noindex`.
  - No inline scripts anywhere.

The full schema is in `supabase/migrations/` and the ingest function in `supabase/functions/ulysse-ingest/`. Both are already applied to the live project; the files are the record.

## The Mall

**Pages:**
- **Overview:** today's and this week's plan, governance due or overdue, upcoming local party visits, scheduled content, latest coverage and volunteer numbers. Each card appears only if your role can see that area.
- **Campaign plan:** day and week views. Only the shared rows are visible to every role.
- **Local party visits**
- **Budget & governance**
- **Volunteers:** anyone can add; only core team and executive see all.
- **Policies**
- **Social media:** accounts grid, outputs log and content pipeline.
- **Coverage**
- **Stakeholders:** anyone can add.
- **Team & access:** people, roles, access dates, last sign-in, the permissions grid and recent activity.

**What every table has:**
- search
- click-to-sort columns
- **CSV** download of what is shown
- "Last edited …" in each edit form

Pages refresh themselves when you come back to the browser tab, so you see other people's changes.

**Coverage of Sarah Olney** fills itself: every 3 hours the collector reads the media outlets' RSS feeds and adds any story naming her. These are marked *auto*; duplicates by URL or outlet+headline are skipped. Anything else can still be added by hand.

## Ulysse (policy tracker)

Refreshed every 3 hours by GitHub Actions (`.github/workflows/update.yml`, or *Run workflow* by hand). It tracks:

1. **Select committees:** reports, special reports and government responses (Parliament Committees API).
2. **Think tanks:** ~63 organisations in `config/sources.yml`.
3. **Lib Dems in the media:** each outlet's own RSS feeds, filtered to stories whose headline or standfirst is about the party.
4. **Political polling:**
   - Wikipedia's UK poll tables: voting intention, MRPs, leader ratings and preferred PM. Each row links to the pollster's own release.
   - YouGov's article pages and News Tracker.
   - ~30 pollsters' sites and polling analysts.
   - A political-only filter.

**Using it:**
- **Filters:** policy area, geography, type, source, House, date range and read/unread. Each dropdown counts only what the other filters leave.
- **Read state** is per person and syncs across devices.
- The page remembers your last tab and filters.
- `/` jumps to search.
- The *Updated …* label turns black if the data is more than 7 hours old.

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
2. The page (and its `www`/bare-host twin, plus `urls:` alternates).
3. Feed autodiscovery and common feed paths. A feed must have at least 3 entries.
4. A scrape of the listing page.
5. **The site's XML sitemap** (advertised in robots.txt for crawlers): its most recently modified pages under the organisation's own path.
   - Topic, series and collection pages are skipped.
   - A university-wide sitemap is never used.
   - The title comes from the URL until the page is read; a later run replaces it with the page's real headline and publication date.
   - Until then, such an item is not marked NEW: a sitemap date is when a page last changed, which for an old report can be yesterday.

`feed: false` skips feeds, `sitemap: false` skips the sitemap. Source health shows the method used and why earlier steps failed.

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

## Checks

`.github/workflows/checks.yml` runs on every pull request and push to main:
- pyflakes
- offline collector tests (`tests/test_collector.py`): robots.txt rules, sitemap fallback, media/coverage filtering, merge, political filter, state safety
- JavaScript syntax
- browser tests (`tests/ui/run.js`): every page as admin, core team and member against a mocked database, under the real security headers, failing on any console error or CSP violation

```bash
pip install -r requirements.txt -r requirements-dev.txt && python -m pytest -q tests
node tests/ui/run.js        # needs Playwright
```

## Settings to switch on in the Supabase dashboard

- **Authentication → Providers → Email → Leaked password protection** (checks new passwords against known breaches; on paid plans).
- **Authentication → URL Configuration:** *Site URL* and *Redirect URLs* = the deployed address, so password-reset links come back to the site.
- **Authentication → SMTP:** a custom sender for real use (the built-in one sends only a few emails per hour).
