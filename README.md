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
3. **Access** (`/access/`): the administrator starts on **Everyone**: every account that has been made, newest first, with a level to choose for **LOVELACE, LUCIEN and LIBBY** on the one row ("No access" removes it; an optional end date sits under each level; accounts with nothing yet are counted as waiting). A tab for each program shows that program's people, managers and shared codes. LOVELACE is given here like the others: the grant sets the person's role and end date (the database copies it onto their profile, which LOVELACE's screens read); LOVELACE → Team & access still sets what each role can do. A program manager (for example LOVELACE's core team) sees only their own program's tab. **Shared codes are kept**: each program's tab lists its codes (the code itself with a Copy button, its label, the level it gives, when it ends, how often it has been used and whether it is live). You can change a code's level or end time, switch it off and on again, or choose your own password when you make one. Codes made before this change were never stored and are marked so; make a new one and switch the old one off.
4. **LIBBY** opens straight on the **Beta test**: no front page and no choice of House. Someone with no LIBBY access yet is asked for the shared beta code once (it is then kept on their account). A person with *Developer* access has a **Developer version** button in the foot of the page (and *Back to the Beta test*), and **Team & access** (the administrator's alone) is a foot link too. The **Theme** button is in the foot of every page, on every program.

## Design

One look for every program, so people can move between them without relearning anything. `site/shared/tokens.css` is the only place colours and fonts are chosen (light, and a dark palette that follows the device or the Theme button in the foot); `site/shared/libby.css` is the shared design system and each program adds only its own layout. **Open Sans** (the brand typeface, self-hosted) and **Democrat Orange** (#ff6400) with the Liberal Democrat **diamond**, always whole, as the one ornament.

The same components everywhere:
- **Header:** a band of colour (orange; green in Honourable LIBBY, red in Noble LIBBY) with the program's name and menu in dark type.
- **Page title:** a tinted band across the page, with the title and a diamond. LOVELACE and LUCIEN show the name of the tab you are on in the same band.
- **Sections:** a tinted bar with a diamond. **Every section heading is a drop-down, closed to start with** (`h2.h2-rule`; `site/shared/dropdowns.js` wraps the heading and what follows it, so a page only writes the heading). Sub-headings (`h3.h3-section`) are drop-downs too, with a smaller diamond; any other drop-down gets the same diamond marker.
- **Tables:** one format, a box with a tinted title row in small capitals and hairline rows, the same padding in every program.
- **Boxes:** white with a hairline, always the full width of the page.
- **Buttons:** orange; a row of simple buttons is a `.button-grid`, several boxes across the page. Section tiles on the home pages are the same grid.
- **Foot:** a tinted band with the Theme button and the program's links.

`node tests/libby-css.js` stops LIBBY's stylesheet choosing its own colours, and `node tests/contrast.js` checks the palette's contrast in both themes.

## Tables

Every table on the site gets, from `site/shared/tables.js` and `tables.css`: a **filter arrow on each column title** (a list of the column's values with a search box, as in Excel or Google Sheets), **sorting**, and a **title row that stays at the top** while you scroll. A "Filtered: showing 3 of 12 rows" line with *Clear filters* appears while a filter is on, and LOVELACE's CSV download follows it. Add `data-nofilter` to a `<table>` to leave it alone.

## LOVELACE (formerly The Mall)

**Pages:**
- **Summary:** what is coming up, day by day: the next three weeks, as a list of the days that have something planned (a day, an area or a section with nothing in it is left out). Each day lists its activities under their area. A section with three or more entries on the Summary shows two and a "+N more" button for the rest.
- **Full Plan** (the Daily Plan, with a month calendar; was *Calendar* and *This Week*): a month calendar with each day's entries in its cell. Click a day for its daily plan, which has six areas, each with sections that can hold several entries (what, time, where, link, notes; add, edit, delete): **Mayor's Activity** and **GLA Activity** (Field Campaign, Media, Membership Engagement, Other Activities), **Internal Campaign** (Membership Engagement, Donor Events, Staff Activities, Other), **Governance and Legal**, **London Politics** (GLA / London Data, Political Events, London Events, then **Policy reports** and **London media** listed under it) and **Parliamentary Activity** (the sixth area). *GLA / London Data* fills itself at 6am and 6pm from the same collector as LUCIEN's Stats calendar, with the GLA and London data drops only (what the London Datastore has published or is expected to publish, and London items added to the Stats calendar by hand); an entry nobody has edited that the feed stops carrying is removed, one a person has edited stays. The UK Parliament's What's On calendar (whatson-api.parliament.uk: both Houses, the next 28 days, without committees' private meetings) is filed under Parliamentary Activity. The Liberal Democrats' London events (events.libdems.org.uk, the London group only) are read at 6am and 6pm and filed on their day under Internal Campaign > Membership Engagement (events over a week long are left out). Every section of a day is open, with its Add button on the title's line (right); an entry's form has a Section drop-down that moves it to another section or area. (The local party visit requests sections were removed; the old table is kept in the database.) Table `day_plan_entries`; the entries of the old plan were mapped across (Action Days and Other Events to Mayor's Activity > Field Campaign, Media Activity to Mayor's Media, Main News to Mayor's Other Activities, Governance to Governance and Legal) and the old tables are left in place as a backup. Every section of a day shows three entries, with **See all (N)** / **See less** for more. **Parliamentary Activity** is the sixth area bar of a day: the UK Parliament's What's On calendar in Commons Business (Chamber and Westminster Hall), Lords Chamber (Chamber and Grand Committee) and Committees.
- **Member's Zone:** the whole week (Monday to Sunday), for volunteers (the *Member* role and others given it). **Today** they see the Mayor's Activity and GLA Activity (every section) and Internal Campaign > Membership Engagement and Other. **Another day of the week** they see only Field Campaign and Membership Engagement under the Mayor's and GLA Activity, and Membership Engagement under Internal Campaign. The database enforces the same rules (row-level security), so the page cannot show more. Never Governance and Legal, London Politics or Parliamentary Activity. Volunteers can also read **Comms** (the media trackers, social tracker, tracked accounts and policies; read-only).
- **Help the Campaign** (a part of the Member's Zone, beside Today): open to every role. A form for a suggestion or an offer to help: your name, your contact (and "happy to be contacted"), what you are suggesting or offering (a venue for events, a contact at an organisation, a policy suggestion, digital communications help with filming or editing, or help at events and set pieces) and further details. It goes to **Suggestions & offers**, a second list on the Volunteers & stakeholders page that the campaign team (core team, executive) sees, with a status and team notes. Table `campaign_suggestions`; permissions `help_offer` (send) and `help_inbox` (read and manage).
- **To-Do-List:** four lists (the Mayor's, the campaign's, the staff's and the volunteers'; the core team adds to each, the same people see them all), each with an action, who is responsible, a link, a tick box for done and further notes. The core team fills it (add, edit, delete); the Candidate role and the executive can read it, and anyone who can read it can tick an item done (a database trigger lets them change only the tick, and records when). Open items come first, with a Done view. Table `mayor_todos`; permission `mayor_todo` (read; write for the core team).
- **The core team can always edit and delete everything** in LOVELACE: their read and write boxes for every area are locked on the permissions grid, and the database refuses to remove them (`guard_core_permissions`).
- **Governance** (was *Budget & governance*)
- **Stakeholders:** one list (Full name, Organisation, Sector, Email, Phone, Point of contact, Notes). Volunteers are filed under Lib Dems. Anyone allowed to add can add; only the full-list roles see everyone's.
- **Comms:** **Media** has the **Overall Media Tracker** (wider political news: Parliament, GLA, council), the **Olney Media Tracker** (news that names Sarah Olney, found automatically at 6am and 6pm) and the **Social Media Channels Tracker**: a list of the accounts being followed, each with its posts (BlueSky and Substack posts are found at 6am and 6pm, others are added by hand). The accounts are kept on the **Tracked accounts** page, where links can be uploaded from a spreadsheet (an account owner and a link; the platform and handle are worked out from the link) or added one at a time. **Policies** is the other section.
- **London Politics** (inside the Full Plan day; a page of its own only for volunteers, who have no Full Plan): **Policy reports** (London think tanks and the GLA: Centre for London, LSE London, London Councils, Trust for London, the Mayor and GLA, Future of London, New London Architecture, London First, plus any national think tank report about London) and **London media** (MyLondon, the Evening Standard, Metro, BBC London: the stories about London government and politics), read by the collector at 6am and 6pm into the table `london_feed` (config `london:` in `config/sources.yml`; they work like LUCIEN's Reports and LD Media). Read by every role.
- **Team & access** (the administrator's alone, as on LUCIEN and LIBBY): people, roles, access dates, last sign-in, the permissions grid and recent activity. On LUCIEN and LIBBY the same page (`site/shared/teampage.js`) lists people, levels, access codes and recent access changes.

**What every table has:**
- search
- click-to-sort columns
- **CSV** download of what is shown
- "Last edited …" in each edit form

Pages refresh themselves when you come back to the browser tab, so you see other people's changes.

**The media trackers fill themselves** at 6am and 6pm (London):
- **News:** the collector reads the media outlets' RSS feeds and adds any story naming Sarah Olney, first by headline and standfirst, then by opening each story from the last two days and looking for her name in the article text (up to 400 pages a run; robots.txt is respected). These are marked *auto* and go to the Olney Media Tracker.
- **Social posts:** it reads the accounts on the *Tracked accounts* page, but only where a platform publishes an open feed for exactly this: **BlueSky** (public API), **Substack** (RSS), **YouTube** (the channel's own video feed; a @handle is looked up on the channel's public page to find its channel id) and **Mastodon** (the account's RSS feed, from `user@instance`). The posts are kept against their account (`social_posts`, through the ingest function's `social_posts` action) and show under it on the Social Media Channels Tracker (the first line of the post is its summary).
- **Instagram, Facebook, X, TikTok and LinkedIn** have no open feed and forbid scraping in their terms (and block the cloud servers the collector runs on), so they are not scraped; add their posts by hand on the tracker. The legitimate ways to automate them are their official APIs, each needing an account set up by the owner: Instagram's Business Discovery (reads public posts of business and creator accounts through a Meta app you control), the X API (a paid plan), and Meta's page APIs for pages you administer. TikTok and LinkedIn offer nothing suitable.
- Duplicates by URL (and, for news, outlet + headline) are skipped. Anything else can still be added by hand.

## LUCIEN (policy tracker, formerly Ulysse)

**Reports** (a tab) lists every select committee report, special report and government response and every think tank report, searchable by words, source, House, type and date; it reads the archive, not the 180-day feed. (It replaces the separate Select committees and Think tanks tabs.) Each committee report links to the publication itself: its document page on committees.parliament.uk, or the Lords' own publications.parliament.uk page, or failing that the committee's page; the address `…/publications/{id}/` on its own is a "page does not exist" on Parliament's site, so it is not used.

**Archive** (a tab): the other tabs show the last 180 days (the live feed is pruned to that). Every item the collector finds is also kept for good in the table `lucien_archive` (migration `20261119100000`), which the **Archive** tab searches (words, kind, source, dates, pages, CSV download of up to 5,000). A new archive is filled with every select committee report, special report and government response the Parliament Committees API holds (back to 1995; read a year at a time, newest first, at most about 20 minutes per run, so it completes over a few runs; set `ARCHIVE_HISTORY=1` to load it again). Think tank, media and polling items are archived from the day the archive began: their feeds and sitemaps only show recent items, so there is no history to fetch. Only the collector writes to the archive (ingest action `archive`).

**Economic policy** (a tab): *Data profiles* answer questions such as "create a data profile, compared to the average, of Londoners aged 18-25": pick an area, ages and sex (or ask in words) and see employment, unemployment, inactivity, self-employment, part-time work, claimant rate, Census 2021 figures, pay and household income beside the average. The data is held in fixed age bands, so a range is matched to the closest band or run of bands (18-25 becomes 16-24) and each line says which it used. The figures are open official statistics from **Nomis** (ONS): Annual Population Survey, Claimant Count, ASHE, GDHI and Census 2021, loaded about weekly into the table `econ_data` by `tracker/econdata.py` (migration `20261120100000`). Nomis' robots.txt asks bots to stay out of its API path, though the API is published for programs to use: `config/sources.yml` (`robots_exceptions`) records that one exception, with its reason; every other site still obeys robots.txt. This replaces the archived `pyscraper` idea (ONS web pages, Bank of England, IMF into pandas); the Bank of England and IMF series can be added the same way. *How the system works* is the rulebook for the whole tax and welfare system covered so far (income tax in England and Scotland, National Insurance for employees, employers and the self-employed, student loans, the High Income Child Benefit Charge, pensions and ISAs, dividends, VAT, Capital Gains Tax, Inheritance Tax, Stamp Duty, Corporation Tax; Universal Credit, the benefit cap, Child Benefit, childcare, JSA/ESA, statutory pay, PIP, Attendance Allowance, Carer's Allowance, State Pension, Pension Credit, Winter Fuel Payment), each with its rates, thresholds, tapers, how it interacts with the others, and a link to its source; plus a **marginal rates explorer** that stacks income tax, National Insurance, student loan, the Child Benefit charge and the withdrawal of Universal Credit to show how much of each extra £1 earned is lost. It lives in `site/lucien/fiscal-system.json`, built by `python3 scripts/lucien/build_fiscal_system.py` from GOV.UK (the benefit amounts are read from the DWP's rates table; each tax rule lists the words that must still be on its GOV.UK page, and the build stops if they are not, so an out-of-date number cannot be published): rebuild it after each Budget or each April. It also covers the duties (fuel, alcohol, tobacco, Air Passenger Duty, Insurance Premium Tax), Council Tax and business rates, Scotland's LBTT, the Employment Allowance, Apprenticeship Levy and capital allowances, Housing Benefit and Local Housing Allowance, the Warm Home Discount, free school meals and the Scottish Child Payment. A "Not covered yet" list says what is still missing and why (Welsh taxes, whose site refuses bots; levies and vehicle tax whose GOV.UK pages carry only old rates; local and per-area numbers). *Costings* is the costing tool: type policy points in words ("raise the basic rate of income tax by 1p"), check how each was read, and get a low / central / high costing for each policy and the package over five fiscal years (2026-27 to 2030-31), with a Monte Carlo range, the assumptions that matter most, the static figure beside the post-behavioural one where a source allows, the interaction between policies, warnings, and every assumption with its source or the word UNSOURCED (download as Markdown, CSV or JSON). It runs in the page in JavaScript (`site/lucien/costing.js`, `costing-page.js`) on `costing-data.json`, built by `scripts/lucien/build_costing_data.py` from HMRC's ready reckoner (June 2025, on the OBR March 2025 baseline; the page says it is out of date) and the OBR's baseline spending; checks in `scripts/lucien/check-costing.mjs`. It is not an official costing. Method, validation and gaps: `docs/methodology.md`; the specification: `docs/COSTING_SPEC.md`. *Indicators* shows the ONS headline series that costings grow with (CPI and CPIH inflation, average weekly earnings, unemployment, employment and inactivity rates, GDP growth, public sector borrowing and debt, job vacancies): the latest figure, the change on a year earlier and a trend line, loaded weekly from the JSON behind each series page on ons.gov.uk (the older api.ons.gov.uk was retired in November 2024). The rulebook's Council Tax entry carries the national averages from the Government's Council Tax levels release.

Refreshed automatically at 6am and 6pm London time by GitHub Actions (`.github/workflows/update.yml`, or *Run workflow* by hand). It tracks:

1. **Select committees:** reports, special reports and government responses (Parliament Committees API).
2. **Think tanks:** ~63 organisations in `config/sources.yml`.
3. **LD Media** (was *Lib Dems in the media*): each outlet's own RSS feeds, filtered to stories whose headline or standfirst is about the party.
4. **Polling**, specific polls and reports (no generic voting-intention averages or Wikipedia tables). Non-political polling (consumer and commercial polls, other countries' politics) is kept too: each item is flagged, and the Polling tab has a Political / Non-political filter:
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
(email + password, or a shared access code), and a person's LIBBY level (Backbench parliamentarian, Frontbencher parliamentarian, Whip, Leader's circle, each one's Staff, and Administrator) is a row on the
Access page. Server routes need these Cloudflare Pages secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `SESSION_SECRET`,
`ANTHROPIC_API_KEY`. The steps to bring it live are in `docs/PHASE-4-GO-LIVE.md`.

**Two Houses.** Only **Today** and **Business** (and the pages under them) have a House. On those pages the whole page takes the House colour (**Honourable LIBBY**, the Commons, green; **Noble LIBBY**, the Lords, red) and a small button at the top right, in the other House's colour, takes you to the other House. Every other page is orange and has no switch. The **home page** has an annunciator for each House (the Chamber now, and Grand Committee / Westminster Hall now and next) above small, compact buttons for the sections. Menu: Today, Business, Legislation, Lib Dems 150, **Whips Hub** (Whip and above) and **POLD Staff** (Staff and above). **Business** has Future (by calendar or by portfolio: the Commons calendar shows Oral Questions by department and the legislation; a portfolio's primary legislation has a Government / other drop-down) and Past. **Legislation** lists every live Bill in either House in three columns, the Bill, its portfolio and its current stage (green in the Commons, red in the Lords); a Bill's portfolio is the department that sponsors it (`billPortfolios` in `lib/libby/parliament.js`, for both Houses; a Private Members' Bill has no department, so it is placed by its subject). A **Bill's own page** opens with its next stage and its team: the adviser and the Bill lead in the Commons and in the Lords (named on the Bill advisers and leads page, under POLD Staff). **Lib Dems 150** holds Policy, Comms (the Lib Dem Lords team's posts, Noble only), the Wallace Room, Room 391, **Ask a Parliamentarian** (anyone asks for help, such as attending an AGM or work experience support, by a date; the requests are on one list everyone can see, and parliamentarians or their staff answer by offering support) and the guides (Organogram link set; the other three links are to come, in `LD150_LINKS` in `pages.js`). **Whips Hub** holds Availability and Data; **POLD Staff** holds the Bill, bulletin and rota tools and Roles. Every drop-down on every page starts closed.

**Three editions, one site.** The edition a person sees is their LIBBY level, set on the Access page:
- **Live:** the roles are Backbench parliamentarian, Frontbencher parliamentarian, Whip, Leader's circle, the Staff of each of those (same access as their principal), and Administrator. For now Backbench and Frontbencher parliamentarians (and their Staff) open the Data page only, as Peers always did; Whips (and Whip's Staff) also the **Whips Hub**; Leader's circle (and its Staff) everything except the back-end, including POLD Staff; Administrators everything including the back-end (rank and open pages: `site/libby/js/pages.js`). Other programs stay the site owner's.
- **For now, every level except Admin and Developer sees only the Data page** (and the home page that leads to it); the server refuses everything else. The rest of LIBBY is built and waiting: `LIVE_PAGES` and `LIVE_ROUTES` in `site/libby/js/pages.js` are the one switch (set `LIVE_PAGES` to `null` to open it up again).
- **Beta test:** the *Beta tester* level (the shared code). They see Today, Business, Legislation and Lib Dems 150, read-only (a page is added to the beta with `beta: true` and its read routes under `betaApi`); the menu, the pages and the server all enforce it. Everyone with a real level sees the pages up to it.
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

## Security and governance

How the site is protected and the rules for changing it: `SECURITY.md`. Who is responsible for what, the personal data held, what to do if something goes wrong, backups, and the actions only the owner can take: `docs/GOVERNANCE.md`. What users are told: `/privacy/`.

## Settings to switch on in the Supabase dashboard

- **Authentication → Providers → Email → Leaked password protection** (checks new passwords against known breaches; on paid plans).
- **Authentication → URL Configuration:** *Site URL* and *Redirect URLs* = the deployed address, so password-reset links come back to the site.
- **Authentication → SMTP:** a custom sender for real use (the built-in one sends only a few emails per hour).

**Data (Whips Hub).** The Data page covers both Houses. **Voting Data** has Lords and Commons buttons: the Lords divisions come from the Lords Votes API (`scripts/libby/ingest_votes.py`, table `lords_divisions`) and the Commons ones from the Commons Votes API (`scripts/libby/ingest_commons_votes.py`, table `commons_divisions`); both are loaded in the 6am and 6pm update and analysed the same way (`lib/libby/voting-analysis.js`, Aye / No in the Commons). **Commons Data** shows the party strengths and the Lib Dem MPs (Members API); the Commons Library's own dashboards sit behind a bot challenge, so the page links to them rather than listing them. **Lords Data** is the Lords Library's dashboards. The **Roles** list (POLD Staff) now covers the Lib Dem MPs as well as the Lib Dem peers: the same role drop-downs, yellow highlighting for people on the Members lists, a House filter, and a House for anyone added by hand (the duty rota and availability for whipping still use the Lords Whips).

**Whips Hub** (was MPs/Peers). **Parliamentary process** (in Lib Dems 150) answers questions about procedure from Erskine May (read live from its API) and the Lords Companion. The Companion cannot be fetched automatically (its site refuses automated requests), so Staff upload the PDF on that page; it is read in the browser and kept in pieces for searching (`process_chunks`). Claude writes each answer from the passages found only, cites them, and says when they do not answer the question; every question and answer stays on a shared list. **Whips' Office Bulletin**: one for the Lords and one for the Commons (the home page shows the House you are in, with a button for the other; the editor has both).

**Issues Tracker and Concessionometer** have moved from Lib Dems 150 to the **Whips Hub** (Whips and above): the Issues Tracker holds campaigns and long-standing issues by portfolio, each with a running list of what has been done (what, date, Hansard link, parliamentarian and staff responsible, notes); the Concessionometer holds every amendment marked WIN on a Bill's Amendments tab, with its Bill's portfolio and the Staff's notes, kept after the Bill has passed.

**Hymn Sheets** (brought across from the old LIBBY repo before it was deleted) is a page in the **Whips Hub**: the hymn sheets the advisers prepare, grouped by Bill, for Whips and above to download; Staff and Admin upload (Word or PDF, up to 4 MB, checked to be what the name says) and delete. Tables `hymn_sheets` and `hymn_sheet_files` (route `functions/api/libby/hymn-sheets.js`, page `site/libby/js/views/hymn-sheets-page.js`).

**Access.** Anyone can make an account, but a new account opens nothing until an administrator approves it: new accounts are listed under **Waiting for your approval** on the Access page's Everyone tab (choose a program and level, then Approve, or Delete). To let someone in without waiting, **Invite someone** (an email, a program and a level; Everyone tab, or a program's own tab): if the email already has an account they get access at once; otherwise Supabase sends them an invite email (if it cannot, the invite is kept and the person just makes an account with that email), and the invite becomes their access the moment the account exists. Changing a level, date, manager setting or a code's level or end time no longer redraws the page: it is saved in place, with a short message, so changes can follow one another. Entries can be deleted for good as well as switched off: a code (**Delete** beside Switch off), an account (administrators; Delete on the Everyone tab), an invite, and in LIBBY a question on Parliamentary process (Staff), a concession (Remove), an issue or its actions (Whips and above), an Ask a Parliamentarian request (Delete request); the other entries already had a Delete.

**Spreadsheet import.** The pages where data is typed in (Issues Tracker, Roles, the Bulletin editor, and Access for inviting many people) each have a folded **Import from a spreadsheet** box: choose an Excel or CSV file, the page matches your own column headings to its fields, shows what it understood and which rows it cannot use, and saves only when you press Add (nothing is overwritten; duplicates are skipped). How it works, how to teach it a new heading, and what Claude Code should do when you share a sample sheet: `docs/IMPORTS.md` and `CLAUDE.md`.
