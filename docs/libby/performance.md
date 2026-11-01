# Performance: where the time goes

This lists the slow spots found when going through the code, what was done about each, and what is left for a decision.
**Nothing here was timed against the live Parliament APIs.** The ranking is by how many outside calls a page makes and whether the
person waits for them, counted from the code. If you want real numbers, open the browser's Network tab on the page before and after.

## How the site worked before

Almost every page made its own calls to the Parliament APIs while the person waited. The only sharing between visitors was the edge
cache in `cached()` (`lib/util.js`), and that is weak for three reasons:

1. it does nothing on `*.pages.dev` addresses (the comment in `util.js` says so);
2. on the real domain it is per Cloudflare data centre, so it is cold for the first visitor in each one;
3. `functions/_middleware.js` rewrites `Cache-Control: public` to `private` on every reply, so Cloudflare never shares an API reply
   between visitors. The `maxAge` values in the routes only make each browser keep its own copy.

## How it works now

`refresh-data.yml` runs at **6am and 6pm London time**. It loads the What's On calendar and the Lords votes,
then `scripts/build-snapshots.mjs` renews the saved copies (`api_snapshots` table). Pages read a saved copy in one database call.
"Refresh now" at the foot of every page redoes the lookups behind the page you are on, for everyone, at most once a minute per lookup.
The rules are in the header of `lib/snapshots.js`.

## Slow spots, most important first

### Fixed

| # | Spot | What it cost | Now |
|---|------|--------------|-----|
| 1 | **Legislation page, "Date of next stage"**: one Parliament call per Bill (`billStages`), asked from the browser 10 Bills at a time, on every visit | one request per 10 Bills, each fanning out to 10 calls; the page filled in row by row | Every Bill's stages are saved. One request answers for all Bills. A Bill with no saved copy is looked up live and the page asks again for those (`missing`) |
| 2 | **Weekends and empty days were scraped live every time.** `whatsOn()` treated any date with no rows as "not loaded" and scraped whatson.parliament.uk (12 s time-out). The ingest skips weekends and writes no rows for a day with no business, so those days were always "missing" | The Future page (35 days) and portfolio pages (28 days) scraped about 10 weekend days plus every recess day, per visitor | The ingest now records which days it looked at (`whatson:ingested`); only weekdays it has not looked at are scraped, a few at a time. Weekends are never scraped |
| 3 | **Past business > Hansard**: Lords and Commons What's On for every day of the month; Commons is never ingested, so it was a live scrape per day | about 2 x 20 scrapes per view | The current and last month are saved; other months are still live, but weekends are skipped |
| 4 | **Portfolio pages**: Bills (several calls), a Bills call and an SI call per department, reports, calendar | roughly 10-15 outside calls per view | All 17 portfolios are saved |
| 5 | **Today page**: Bills list, peers list, then a Hansard lookup for every statement / urgent question, all started at once with no limit | many calls, 6 s time-outs. Items beyond the first 8 were not waited for, so they were usually sent with an **empty link** (a bug) | Today and the next 7 days are saved. Hansard lookups are capped at 8 and every item starts with the Hansard search page as its link |
| 6 | **Bills list and Lib Dem peers**: pages read one after another (50 Bills / 20 peers per page), and the peers list was needed on every page load | 2-3 and 4-5 calls in a row | Saved; when live, the pages after the first are asked for together (`allPages` in `lib/parliament.js`) |
| 7 | **Voting Data**: read `lords_divisions` 1,000 rows at a time, one page after another, then recalculated for every visitor | several round trips plus the analysis per view | The default range (whole Parliament to today) is saved. Other ranges read five pages at a time |
| 8 | **Past business first pages** (votes, questions, statements): a live Parliament call on every visit | 1 call each | The first page with no search is saved. Later pages and searches are still live |
| 9 | **Item links on the Today page** (`/api/item-links`): up to 3 outside calls per statutory instrument / report / motion, three at a time, rechecked in every data centre every hour | many requests after the page appears | Each item is looked up once and saved (`links:` copies). "Refresh now" looks them up again |
| 10 | **Amendments**: up to 20 pages of 100, one after another | slow on big Bills | The pages after the first are asked for together |
| 11 | **Name highlighting** (`hl()` in `ui.js`): built and ran one regular expression per Lib Dem peer for every piece of text, and rebuilt the sorted list on every API reply | roughly 100 passes over every string | One pattern, built once, rebuilt only if the peer list changes |
| 12 | **Live panel** polled every minute even in a background tab; every viewer caused their own annunciator call | wasted calls | Paused in a hidden tab; one annunciator lookup shared for 20 s (works on the real domain only, see above) |
| 13 | **Supabase calls had no time-out** | a slow database could hold a page for ever | 10 s limit |
| 14 | Google Fonts blocked first paint; `matchBill` re-normalised every Bill title for every item | small | font stylesheet no longer blocks; titles normalised once per list |

### Not fixed: these need a decision from you

**A. Every JavaScript and CSS file is revalidated on every visit** (`public/_headers`: `Cache-Control: no-cache`). The site has no
build step, so there are no versioned file names and `no-cache` is the safe setting. The cost is about 25 small requests, and the page
modules load in a chain (`app.js`, then `api.js`/`ui.js`/`session.js`/`pages.js`, then the view, then its helpers), so latency adds up.
*Options:* (1) add a tiny build (esbuild) that bundles and writes hashed file names, then set `immutable`; (2) keep it as is and add
`<link rel="modulepreload">` for the common modules (cheap, partial gain); (3) accept it. I added `modulepreload` for `app.js` only.

**B. Every request, including every static file, runs through `functions/_middleware.js`** (`_routes.json` is `/*`), which does a
Web Crypto HMAC each time and counts as a Function invocation against the project's request allowance. This is deliberate (nothing is served
without signing in) but it means static files are never served straight from Cloudflare's network.
*Options:* put Cloudflare Access in front instead of shared codes; or leave the JS/CSS outside the front door (the files hold no
secrets, but then anyone with the address can read the site's code).

**C. The Bill page and amendments are still live.** `/api/bills/:id` makes 3 Parliament calls plus a Forthcoming Business query per
view; the amendments list makes one call per 100 amendments. These are the pages where people want the very latest, so I left them
live. *Option:* save them with the same mechanism and rely on "Refresh now" (about 60 Bills x 2-3 calls added to each scheduled run).

**D. Searches and later pages in Past business** go straight to the Parliament APIs, as does each committee's publications (up to 3
pages in a row). *Option:* copy written questions and statements into Supabase each morning (as is already done for votes) and search
them there with Postgres full text, like the policy library.

**E. Where Supabase and the Cloudflare Functions run.** Each page makes several separate HTTPS calls to Supabase. If the Supabase
region is far from where Cloudflare runs the Function, each costs a round trip. *Options:* check the Supabase region against the
Cloudflare data centres your users hit; try Smart Placement for the project (I have not tested whether it helps here).

**F. The Python ingest waits 1 second after every request** (`http_get` in `scripts/common.py`) and fetches days one at a time.
About 30 weekdays take around a minute per run. That does not slow the site, but it sets the length of each scheduled run.
*Option:* fetch 4 days at once if runs ever need to be shorter.

**G. The Whips' Today's Lists page** is scraped live (and the README says Forthcoming Business is blocked by that site). It is read
when the day is renewed, so visitors no longer wait for it, but if it is slow or blocked the saved Today page falls back to What's On.

### Not reviewed closely

I read the server routes and shared libraries line by line. The large page files (`bill-page.js`, `data-page.js`, `whips-page.js`,
`wallace-room-page.js`, `adviser-editor-page.js`, `docs/*`) I only searched for repeated or serial API calls; none were found except
the ones above. The Claude calls (`oq-suggest`, `draft-amendment`, `grid-text`) were not looked at for speed.

## Decisions I made that you may want to change

- **Runs every day, including weekends.** To run Monday to Friday only, change the cron line in `refresh-data.yml` to
  `'7 7-18 * * 1-5'`.
- **A saved copy is trusted for up to 30 hours** (`MAX_AGE_MS` in `lib/snapshots.js`). Past that it is looked up live again.
- **"Refresh now" is open to everyone signed in**, including Peers, limited to once a minute per lookup (`MIN_REFRESH_GAP_MS`).
- **A lookup that finds no link is saved too**, so a Library briefing published after the lookup does not appear until the next
  "Refresh now" (up to 30 hours). Say if you would rather not save "nothing found".
- **If a live lookup fails, the old saved copy is shown** instead of an error. The foot of the site says when the data was last
  renewed, and how many lookups failed on the last scheduled run.
