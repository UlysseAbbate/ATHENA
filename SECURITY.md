# Security

Athena is a private working site. This file says how it is protected, what to do if something goes wrong, and what must stay true when the code changes.

## Reporting a problem

Tell the site owner straight away (the repository owner on GitHub). Do not open a public issue for anything that exposes data or access.

## How the site is protected

| Layer | What it does | Where |
|---|---|---|
| Sign-in | Supabase Auth (email and password, or a shared access code that signs in as a hidden account with one level). New accounts open nothing until an administrator approves them. | `site/shared/authui.js`, `functions/api/code-login.js` |
| Database | Row-level security on every table. Tables LIBBY uses have no policies at all: only the server (service role) reads and writes them. LOVELACE and LUCIEN tables have policies tied to `access_grants`. Nothing is readable signed out. | `supabase/migrations/` |
| Server gate | Every `/api/libby/*` route passes `_middleware.js`: signed in, has a LIBBY level, the level is high enough for the route and method (rules in `site/libby/js/pages.js`), and a request that changes data comes from this site's own pages. Each writing route checks the level again (`passcodeProblem`). | `functions/api/libby/_middleware.js`, `lib/libby/auth.js` |
| Browser | A strict Content-Security-Policy (scripts only from this site, no inline scripts), no framing, HTTPS only, not indexed. All third-party libraries are served from this site. | `site/_headers` |
| Guessing | Wrong access codes are throttled per connection (10 in 15 minutes) and slowed. Passwords are throttled by Supabase. | `lib/libby/throttle.js` |
| Secrets | Only in Cloudflare Pages settings, GitHub Actions secrets and Supabase function secrets. Never in the repository; the browser only ever holds the public (publishable) Supabase key. | |
| Errors | The full error goes to the server log; the browser is never sent database details. | `lib/libby/util.js` (`publicMessage`) |
| Automation | Workflows have read-only repository permission. Dependabot proposes updates to Actions and Python packages weekly. | `.github/` |

## Rules for changes

- A new table: enable row-level security in the same migration, and revoke everything from `anon` and `authenticated` unless a policy is written for it.
- A new `/api/libby` route that changes data must call `passcodeProblem` (checked by `node scripts/libby/check-site.mjs`) and must be listed against its page in `pages.js`.
- Text from people or from outside sources goes into the page through `esc()`; never build HTML from it directly.
- A database function marked `security definer` must set `search_path = ''` and check who is calling.
- No new third-party script hosts: vendor the library into the site instead.
- Run the checks in `CLAUDE.md` before every merge.

## Known gaps (the owner's to close)

See "Actions for the owner" in `docs/GOVERNANCE.md`.
