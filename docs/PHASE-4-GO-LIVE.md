# Phase 4 go-live: what is built, and the steps only you can do

LIBBY's code now lives in this repo and signs in through Athena. Nothing below has been applied to the live Athena database,
Cloudflare or GitHub secrets yet. **The old LIBBY site (odysseus.org.uk) and its database are untouched and keep working.**

## What changed in the code

| | Before (LIBBY repo) | Now (this repo) |
|---|---|---|
| Pages | `public/` at the site root | `site/libby/`, served at `/libby/` |
| Server routes | `functions/api/*` at `/api/*` | `functions/api/libby/*` at `/api/libby/*` |
| Helpers | `lib/` | `lib/libby/` |
| Jobs | `scripts/`, workflows `*.yml` | `scripts/libby/`, workflows `libby-*.yml` (scheduled runs switched **off**) |
| Sign-in | pick a role, type its shared password; cookie `lb_session` | Athena sign-in (email + password) or a shared access code; token sent as cookie `athena_at` (path `/api/libby`) or an `Authorization` header |
| Who has which level | `ACCESS_*` secrets | `access_grants` rows (Access page), `level_of()` in the database |
| Database | LIBBY's own Supabase project | tables in the Athena project (`supabase/migrations/20261024110000_libby_tables.sql`) |
| Libraries for Word/Excel/PDF | loaded from jsDelivr | copied into `site/libby/vendor` (the security policy allows no outside scripts) |
| Fonts | Google Fonts | self-hosted (`site/shared/fonts`) |

Because the sign-in now happens in the browser, LIBBY's *page code* (not its data) can be downloaded by anyone who opens
`/libby/`. All data is behind `/api/libby/*`, which refuses anyone without a LIBBY level.

## Steps for you, in order

1. **Cloudflare project type.** `functions/` only runs on a Cloudflare *Pages* project built from the repo root with output
   directory `site`. Check Athena's project is that (if it is a Workers static-assets project, tell me and I will adapt it).
2. **Apply the migrations to the Athena Supabase project**, in order: `20261024100000_program_access.sql`, then
   `20261024110000_libby_tables.sql`. (Ask me and I will apply them with the Supabase connector once you say go.)
3. **Cloudflare variables and secrets** (Pages → Settings → Variables and secrets), the same as LIBBY had, but pointing at the
   Athena project: `SUPABASE_URL` = `https://fbsoibmtvapmxdlfdgxc.supabase.co`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`,
   plus `SUPABASE_ANON_KEY` (the publishable key already in `site/shared/config.js`) and `SESSION_SECRET` (any random 32+
   characters; used only to hash addresses for the guessing throttle). `CLAUDE_MODEL` = `claude-sonnet-5`.
4. **Supabase → Authentication → URL Configuration:** add `https://athena.odysseus.org.uk` as the Site URL and redirect URL.
5. **Copy LIBBY's data across** (reads the old project, writes the new one; safe to repeat):
   `OLD_SUPABASE_URL=… OLD_SERVICE_KEY=… NEW_SUPABASE_URL=… NEW_SERVICE_KEY=… node scripts/libby/copy-data.mjs --dry-run`, then
   without `--dry-run`.
6. **Give people access.** Your own account already has every program. On `/access/` give each person a LIBBY level, or make a
   shared code for Peers (Access → LIBBY → Access codes).
7. **Try it** at `https://<branch>.<project>.pages.dev/libby/` (Cloudflare builds every branch) as an admin, a Whip and a Peer
   before anyone else is told.
8. **Turn the scheduled jobs on** (uncomment the `schedule:` blocks in `.github/workflows/libby-*.yml`) and add the GitHub
   Actions secrets `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY` for this repo. Switch the old repo's jobs
   off at the same time so two copies do not run.
9. **DNS:** add `athena` (a CNAME to the Pages project) in the odysseus.org.uk DNS, and the custom domain in Pages. Nothing on
   `odysseus.org.uk` itself changes.

## What stays the same until you say otherwise

The old LIBBY site keeps its own login and database. Retiring it (phase 6) is a separate decision.
