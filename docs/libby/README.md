> **Moved.** LIBBY now lives inside the Athena repo (`site/libby`, `functions/api/libby`, `lib/libby`, `scripts/libby`) and signs in
> through Athena: there are no role passwords any more. Who gets which LIBBY level is set on the Access page (`/access/`), and a
> shared code can stand in for an account. Everything below about *Access*, *Secrets* and sign-in is the old arrangement, kept for
> reference; the rest (pages, saved copies, Whips' tools, portfolio tags) still applies. See `docs/MASTER-PLAN.md`.

# LIBBY

**Liberal Intelligence for Business, Briefings and Year-round policy.**

LIBBY is one website for the day-to-day business of the Liberal Democrat Lords team (the Lords Whips' Office). Plain HTML, CSS and JavaScript (no build step),
Cloudflare Pages for hosting and the server routes, Supabase for the database, Claude for drafting.

Live site: https://odysseus.org.uk

## Where things are

```
public/                   the website (served as it is)
  index.html              the one page; the menu is built by app.js
  styles.css              THE stylesheet. All styles live here.
  js/pages.js             THE LIST OF PAGES: menu, who may see what, which /api routes belong to which page
  js/app.js               the router; it just follows pages.js
  js/session.js           who is signed in (the browser's side)
  js/views/*-page.js      one file per page
  js/docs/                reading groupings and writing the Word grids / hymn sheets
functions/                server code (Cloudflare Pages Functions)
  _middleware.js          the front door: nothing is served without signing in
  api/                    one file per /api route
lib/                      shared server code (Parliament APIs, Supabase, Claude, access)
scripts/                  Python jobs run by GitHub Actions, and check-site.mjs
supabase/schema.sql       the complete current database
docs/adding-a-page.md     how to add a page
```

## Access

People sign in by choosing a **role** and typing that role's password. Six roles:

| Role | Can do |
|---|---|
| **Peer** | read (the Legislation, Business and Policy pages, and book the Wallace Room) |
| **Whip** | also the Data page, the Whips page (Availability for Whipping) and read stakeholders and amendment flags |
| **Leader's circle** | everything except the back-end (so POLD Staff too) |
| **Staff** | everything except the back-channel operations: also comments, drafting, stakeholders, amendment flags, the Advisers pages (Bill advisers, groupings and grids, the Bulletin, the duty rota, Availability, the Wallace Room) and Comms |
| **Admin** | everything, including the back-channel operations |

The only back-channel operation today is changing who has which role (the **Roles** page). Give a future back-channel route the `BACKCHANNEL`
level in `public/js/pages.js` (a route that is not listed there needs Admin for anything but reading).

Each role has one shared password, kept as a Cloudflare secret: `ACCESS_PEERS`, `ACCESS_WHIPS`, `ACCESS_SPOKESPERSON`, `ACCESS_LEADER`
(Leader's office), `ACCESS_STAFF`, `ACCESS_ADMIN`. **A role with no password set is not offered on the sign-in page.** Changing a password signs
out everyone who signed in with it. Who may use each page and each `/api` route is written once, in `public/js/pages.js`; the roles and
their ranks are at the top of that file (Whip, Spokesperson and Leader's office share a rank, so to give one of them more or less access,
change its number there). The one switch for the Whips' Office features (comments, drafting, grids, stakeholders, flags, Comms updates)
is `WHIPS_FEATURES` at the top of that file.

**Guessing protection:** after 10 wrong passwords from one connection within 15 minutes, sign-in from that connection pauses for
15 minutes (`lib/throttle.js`; failures are kept as a keyed hash of the address, never the address, and deleted after a day; if the
database is unreachable, sign-in is not blocked). Every response carries security headers (no framing by other sites, no MIME sniffing,
HTTPS only, not indexed). Use long passwords (12+ characters) for the role secrets: they are shared by everyone in a role.
`node scripts/check-access.mjs` checks all of this without Cloudflare or a database.

**Roles page (Admin).** A compact table of every Liberal Democrat peer on the Members list and their role (Peer, Whip, Spokesperson,
Leader's office, Staff, Admin), changed from a drop-down. People who are not on the Members list (staff) are added at the end and can be
removed. This table is a directory: it decides who is listed as a Whip on the Whips pages (the duty rota and Availability for Whipping).
It does not give anyone access; that comes from the role and password chosen at sign-in. Until someone has been given the Whip role, the
Whips pages list every Lib Dem peer so they keep working.

## Secrets

Cloudflare Pages -> Settings -> Variables and secrets: `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
and the six role passwords `ACCESS_PEERS`, `ACCESS_WHIPS`, `ACCESS_SPOKESPERSON`, `ACCESS_LEADER`, `ACCESS_STAFF`, `ACCESS_ADMIN`. (The model is `CLAUDE_MODEL` in `wrangler.toml`.)
GitHub -> Settings -> Secrets and variables -> Actions: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`.

## Scheduled jobs (GitHub Actions)

- `refresh-data.yml`: **6am and 6pm London time, every day** (times in `lib/schedule.js`). It loads the What's On calendar
  (`ingest-whatson.yml`, from the What's On API), the Lords' business (`libby-ingest-business.yml`) and the Lords divisions (`ingest-votes.yml`), then `scripts/build-snapshots.mjs` renews the saved copies of the slow
  Parliament lookups (see "Saved copies" below). Can be run by hand from the Actions tab.
- `ingest-policy.yml`: the Lib Dem policy library, weekly.
- `libby-ingest-business.yml`: the Lords’ Future Business and Order Paper, from the Lords Business API (replaces the Whips’ Office PDF, which the Whips’ site refuses to serve to automated requests).
- `check.yml`: checks the site on every commit.

## Saved copies (why pages open quickly)

The Parliament APIs are slow (the list of Bills alone is several calls, and every Bill's stages another call each). So the site does not
search them while someone waits. The scheduled job above saves the results in the `api_snapshots` table; a page reads the saved copy in one
quick database call. `lib/snapshots.js` explains the rules:

- A saved copy is used as it is. If there is none (or it is over 30 hours old because the job stopped) the lookup is done live and saved.
- If a live lookup fails, the old saved copy is shown rather than an error.
- **Refresh now** (foot of every page) asks for fresh data: the lookups behind the page you are on are done live and saved for everyone.
  Nothing can be re-done more than once a minute, however often the button is pressed.
- The line at the foot shows when the data was last renewed and when the next update is (`/api/status`).

Where the time goes, and what could still be made faster, is written up in `docs/performance.md`.

## The Bill page

Each Bill has three buttons: **Stages**, **Amendments** and **Stakeholders** (Whips and above). The chosen one is kept in the address
(`#/bill/4001?tab=amendments`), so a link opens the same section.

- **Stages**: each stage lists its documents as a few dropdowns by kind (Notices of amendments, Marshalled lists, Written submissions and
  evidence, Briefings, Memoranda, Impact assessments, Letters...). The kinds and what goes in each are in `public/js/doc-groups.js`:
  change a pattern there to move a kind of document.
- **Amendments**: one table of every amendment at the stage: Signed peers (one per line), # (the amendment's number, a dash while there is none), Location (C3, P2, L14),
  the Member's explanatory statement (fetched from the Parliament API as rows come into view) and small buttons on two lines: *Vote* (orange), *C* (Content, green) and
  *NC* (Not Content, red); then *Comment* (black). C and NC cancel each other, and setting either also sets Vote. Click a row, or Comment, to open the text and
  comments. The highlights above the table (All, Lib Dem amendments, Lib Dem-signed, Voting, Content, Not Content) narrow the table. Saved in `amendment_flags`.
- **Stakeholders**: organisation, name, contact, their position, and a briefing typed in, uploaded (Word or PDF, up to 4 MB), or both.
  Saved in `bill_stakeholders` (the file in `bill_stakeholder_files`). Both need `supabase/migrations/003_stakeholders-and-flags.sql`.

Whips and above can read stakeholders and flags; changing them needs the Whips' Office features level (`WHIPS_FEATURES` in `public/js/pages.js`).

## Today's List (the Today page)

Staff and Admin can upload the Government Whips' Office **Today's Lists** PDF for a day, from the panel at the top of the Today page (or any
day's page). The PDF is read **in the browser** (pdf.js, loaded on demand); only the text found in it is sent to the server. The business
on the page then comes from the list: prayers, introductions, each question with its minister, the time-limited debates with their
speakers' lists and speech limits, groupings and the rising times. It takes priority over the other sources, which stay listed
underneath. A list is saved per day (`todays_lists`); uploading again replaces it and keeps that day's changes.

- **Duty Whips** (chosen on the Whips page) show at the top of every day's page.
- **Estimated start times** appear beside each piece of business. A length the list gives is used; anything else uses the rules,
  taken from the Companion to the Standing Orders (2025) where it has a figure (the paragraph is shown beside each rule) and marked
  *estimate* where it has none (those are for the Whips' Office to set). Staff can change a start time or length for one item (the rest
  move with it), hide one time or all of them, change a sitting's start, and edit the rules for every day. All in `public/js/docs/sitting-times.js`.
- **Speakers**: each speakers' list from the PDF is under the item; Staff can add peers who are speaking (and remove those they added),
  for any item. Lib Dem peers are highlighted.
- If a list's layout ever defeats the reader, add the list's text as a fixture in `scripts/fixtures` and fix `public/js/docs/list-parser.js`
  until `node scripts/check-list.mjs` passes (it also runs on every commit).

## Portfolio tags

Every Bill, every piece of legislation on the day pages and every policy document carries at least one portfolio (department).
The list of portfolios, with each one's department names and keywords, is `lib/portfolios-data.js`: edit it once and both the website and
the Python jobs follow.

- **Bills** (`lib/bill-tags.js`): placed by the department that sponsors them, otherwise by keywords in the title, long title and
  summary, otherwise under the Cabinet Office. Those last ones show "(default)" on the Legislation page and are listed in the
  "Renew the saved copies" log. To place one by hand, add it to `lib/portfolio-overrides.js`.
- **Legislation on the day pages and the Future calendar** takes its Bill's portfolio; a statutory instrument is placed by its wording.
- **Policy documents** are tagged when the library is built (`scripts/ingest_policy.py`). One that fits nothing, or whose PDF text is
  unreadable, still gets a portfolio (the title decides; the Cabinet Office is the last resort). Run the "Ingest Lib Dem policy"
  workflow with **retag** ticked to tag any stored document that has none.

## Changing the site

1. **Adding a page:** see `docs/adding-a-page.md`. One new file and one line in `pages.js`.
2. **Database changes:** add to `supabase/schema.sql` and as a numbered file in `supabase/migrations/`.
3. **Check:** `node scripts/check-site.mjs` (it also runs by itself on GitHub).

### Trying a change safely

Make changes on a **branch**, not on `main`. Cloudflare builds every branch at its own address
(`<branch>.odysseus-lords-whips.pages.dev`), so you can look at the change before anyone else sees it. When it looks right, open a
pull request and merge it; `main` then goes live. The branch address needs the same secrets set under Cloudflare's **Preview**
environment (Settings -> Variables and secrets -> Preview), and it uses the same database, so do not delete real data while testing.

## If the site goes blank

Almost always a script file is missing or has the wrong name. Open the browser console (Mac: Cmd+Option+J): "Failed to load module
script ... text/html" means a file is missing. Run `node scripts/check-site.mjs` or look at the red cross next to the last commit
on GitHub: it names the file. Cloudflare -> Deployments -> an earlier deployment -> Rollback restores the last good version.

## Where the Forthcoming and Today's business come from

Both pages are built from two official Parliament APIs (read by `scripts/libby/ingest_lordsbusiness.py` and `ingest_whatson.py`, mapped in `scripts/libby/parliament_api.py`, stored in `whips_business` and `whatson_events`):

- **Lords Business API** (`services.lordsbusiness.parliament.uk`): the House's own **Future Business** (the coming sitting days) and the **Order Paper** for each coming sitting day, item by item, with the member named first (Parliament's member id, which marks Lib Dem peers exactly).
- **What's On API** (`whatson-api.parliament.uk`): the calendar, with the members and their party, the Bill an item is about, the room, the times, the estimated rising time, the committee meetings, and each debate's **speakers list** (shown under the item when *Speakers* is pressed; Lib Dems are marked).

The APIs are the only automatic sources. For one day the page uses a Today's List that Staff have uploaded, if there is one (an optional extra that carries the groupings of amendments); otherwise the Order Paper, then Future Business, then the calendar alone, with the calendar added on top for the Bill, the speakers, the room and the Committees section. Each is read from the copy in Supabase (renewed by the ingest workflows) and, for a day the copy does not hold, straight from the API. The Whips' Office website and PDF are not read at all.

> Updated for the Whips Hub: the roles are now Backbench parliamentarian, Frontbencher parliamentarian, Whip, Leader's circle, each one's Staff (same access as their principal) and Administrator. The older rows above (Peer, Spokesperson, Staff) are the previous names; see `site/libby/js/pages.js` for the current ranks.
