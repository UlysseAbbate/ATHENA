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

## Done already (24 Oct 2026)

- Both migrations are applied to the live ATHENA project (`program_access`, `libby_tables`). Your own account was carried over as a LOVELACE core-team manager; nothing else changed for existing users.
- LIBBY's hand-entered data was copied from the old LIBBY project into ATHENA and checked against it: the 34 people and roles, the Wallace Room series and 65 bookings, 10 Bill advisers, the duty whip, the bulletin and the 3 amendment groupings. The old project was only read.
- Not copied, because the scheduled jobs rebuild them: the policy library (286 documents, about 11,000 extracts), What's On events, Lords divisions, the saved Parliament copies. One Today's List PDF can simply be uploaded again. `scripts/libby/copy-data.mjs` copies everything if you prefer.

## Steps for you, in order

1. **Cloudflare variables and secrets.** Cloudflare dashboard -> Workers & Pages -> the Athena project -> Settings -> Variables and Secrets -> Add (set them for both Production and Preview):

   | Name | Type | Value |
   |---|---|---|
   | `SUPABASE_URL` | text | `https://fbsoibmtvapmxdlfdgxc.supabase.co` |
   | `SUPABASE_ANON_KEY` | text | `sb_publishable_nB-qsQvg3a-XAaKih5D1zg_itd_Gyor` (public by design) |
   | `SUPABASE_SERVICE_ROLE_KEY` | **secret** | Supabase dashboard -> ATHENA project -> Project Settings -> API Keys -> the `service_role` / secret key. Never put this in the repo or paste it into chat. |
   | `SESSION_SECRET` | **secret** | Any long random string (32+ characters). Make one with a password manager, or `openssl rand -hex 32`. Used only to scramble addresses for the guessing throttle. |
   | `ANTHROPIC_API_KEY` | **secret** | The same key the old LIBBY project uses (Cloudflare -> the old LIBBY Pages project -> its variables), or a new one from console.anthropic.com. |
   | `CLAUDE_MODEL` | text | `claude-sonnet-5` (what LIBBY used) |

2. **Supabase sign-in addresses.** Supabase dashboard -> ATHENA project -> Authentication -> URL Configuration
   (https://supabase.com/dashboard/project/fbsoibmtvapmxdlfdgxc/auth/url-configuration). Add `https://athena.odysseus.org.uk/**` under **Redirect URLs** now.
   Change **Site URL** to `https://athena.odysseus.org.uk` only when that address is live (password-reset emails use it).
3. **The address.** Cloudflare -> Workers & Pages -> the Athena project -> Custom domains -> Set up a custom domain -> `athena.odysseus.org.uk`.
   If odysseus.org.uk's DNS is on Cloudflare, it adds the record for you in one click. If the DNS is elsewhere (your registrar), Cloudflare shows you one
   CNAME to add there: name `athena`, target the project's `.pages.dev` address. Nothing on odysseus.org.uk itself changes.
4. **Try it** on the branch preview address (Cloudflare -> Deployments -> the `master-plan` branch) before merging: sign in as yourself, open each program,
   then make a test Peer code on the Access page and sign in with it in a private window.
5. **Merge `master-plan` into main** (pull request on GitHub), so the live site updates.
6. **GitHub Actions secrets** (repo -> Settings -> Secrets and variables -> Actions): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`. Then
   run **Ingest Lib Dem policy** and **Refresh data** once by hand (Actions tab -> Run workflow) to fill the policy library and saved copies, and remove the `#` in front
   of the `schedule:` lines in `.github/workflows/libby-*.yml`. Switch the old LIBBY repo's schedules off at the same time.

## What stays the same until you say otherwise

The old LIBBY site keeps its own login and database. Retiring it (phase 6) is a separate decision.
