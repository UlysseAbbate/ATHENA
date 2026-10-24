# Athena master plan

Status: **draft for approval** · Drafted 2026-10-24

## 1. Aim

One site, one login, one admin console. Athena is the front door; three programs sit under it:

| Program | Stands for | Today | Becomes |
|---|---|---|---|
| **Lovelace** | London Organisation for Voters, Engagement, Liberalism, Action, Campaigns & Elections | The Mall (`athena/site/mall/`, plus the empty `MALL` repo) | `/lovelace/` |
| **Lucien** | Letting You Catch Important Events & News | Ulysse policy tracker (`athena/site/ulysse/`, `tracker/`, `ulysse-ingest`) | `/lucien/` |
| **LIBBY** | Liberal Intelligence for Business, Briefings and Year-round policy | Own repo, own site (odysseus.org.uk), shared role passwords | `/libby/` (unchanged in function) |

Three requirements run through everything:

1. **Everything behind one login.**
2. **The admin (ulysse.abbate@gmail.com) decides who gets which program and at what level**, through the admin back-channel.
3. **One look, LIBBY's, in light and dark.**

## 2. Where things are now (what makes this a rejig, not a rename)

| | Athena (Mall + Ulysse) | LIBBY |
|---|---|---|
| Who you are | Supabase Auth, email + password | No individual identity: pick a role, type that role's shared password |
| Where permissions live | Postgres row-level security (`role_permissions`, `my_access()`) | `public/js/pages.js` (ranks) + `lib/access.js` + `functions/_middleware.js` |
| Who can change them | Core team in *Team & access*; admin bound in `admins` table | Admin role, "Roles" page (that page is only a directory, it grants nothing) |
| Hosting | Static Cloudflare site, Supabase `ATHENA` project | Cloudflare Pages + Functions, uses the Supabase service-role key server-side |
| Style | `athena.css`: LIBBY-derived "Focus" look **with** dark mode (follows OS) | `styles.css`: full leaflet look, **light only**, no dark mode or toggle |
| Fonts | Self-hosted only (CSP `font-src 'self'`) | Libre Franklin from Google Fonts |

The two access models are the real work. LIBBY's shared passwords cannot say *who* did anything or switch one person off; Athena's can. The plan moves LIBBY onto Athena's model.

## 3. Target architecture

```
                     athena (site root)
   sign in once  ->  home: cards for the programs you may open
        |
        +-- /lovelace/   campaign workspace
        +-- /lucien/     policy, media and polling tracker
        +-- /libby/      Lords Whips' Office (functions behind /api/libby/*)
        +-- /admin/      master console (admin only)
```

### 3.1 Identity: one account per person

- **Supabase Auth in the existing `ATHENA` project** is the only way in. Email + password, optionally magic link.
- Self-sign-up stays possible but a new account sees **nothing** until the admin grants access (today's behaviour, kept).
- LIBBY's login screen, the six `ACCESS_*` passwords and the `lb_session` ticket are retired (see §7, decision 2 for a break-glass exception).

### 3.2 Access: program × level × expiry

New, program-agnostic tables replace the Mall-only `profiles.role`:

- `programs` — `lovelace`, `lucien`, `libby`, `admin`.
- `program_levels` — the levels each program offers, ordered:
  - Lovelace keeps its six roles (Core team … Member) and the existing `role_permissions` grid.
  - Lucien: *Viewer* (read), *Editor* (read state, source suggestions), *Manager*.
  - LIBBY keeps its six levels (Peer, Whip, Spokesperson, Leader's office, Staff, Admin) and their ranks.
- `access_grants (user_id, program, level, expires_at, granted_by, granted_at)` — one row per person per program. A person can be a Whip in LIBBY, a Candidate in Lovelace and have no Lucien access.
- `my_access()` returns every grant that has not expired; the home page, each program and the database all read from it.
- Existing guard rails carry over, now per program: nobody edits their own grant; only the admin grants admin-level; the admin account cannot be changed by anyone else; the admin's own access cannot be switched off.
- Every grant or revoke goes to `audit_log`.
- Migration: existing `profiles.role` becomes a Lovelace grant; the admin gets all programs; Ulysse access already opened to a role becomes a Lucien grant for those people.

**Where each program enforces it**

| Program | Enforcement |
|---|---|
| Lovelace, Lucien | Row-level security in Postgres (as now), reading `access_grants` |
| LIBBY | Cloudflare Functions verify the Supabase JWT, look up the person's LIBBY level, then apply the existing `pages.js` rules unchanged. The service-role key stays server-side. |

### 3.3 Admin console (`/admin/`) and the back-channel

The admin page grows from "system status" into the one place that controls access:

- **People:** every account, last sign-in, program grants with level and *access until*, grant/change/revoke, invite by email.
- **Programs:** the level tables and the permissions grids (Lovelace's grid moves here from *Team & access*, which then shows only Lovelace-level people).
- **Back-channel operations** (admin only, never delegated): the actions LIBBY calls `BACKCHANNEL` plus everything that changes access itself. These live under `/admin/` and `/api/admin/*`, and are the only routes that accept admin-level changes.
- **Activity:** one audit log across programs; collector health and failing sources (today's content) stays.
- **Delegation (optional):** the admin may let a trusted person manage grants *within one program* (e.g. Lovelace core team manages Lovelace members) without seeing the others. Off by default.
- You said "preferably through the back-channels, otherwise my own account": the back-channel is `/admin/` signed in as the admin account; there is no second route.

### 3.4 One look: LIBBY's, in light and dark

- A single stylesheet, `athena/site/shared/libby.css`, becomes the only design source. It is LIBBY's leaflet look (Lib Dem yellow and black, heavy Libre Franklin headlines with highlighter, hard offset shadow panels, pill buttons) expressed as tokens.
- **Dark mode is new design work for LIBBY**, which has none today. Athena's existing dark tokens are the starting point; the leaflet devices need dark equivalents (the yellow offset shadow, the black header bar and red rule, tinted flag colours).
- Theme: follows the OS by default; a toggle in the header (Auto / Light / Dark) stores the choice in the browser. Applied by a tiny external `theme.js` loaded in `<head>` so there is no flash and no inline script (CSP stays strict).
- Shared pieces, written once: masthead and program switcher, sign-in form, buttons, tables, forms, cards, badges, flag colours, toasts.
- Libre Franklin is self-hosted so CSP can stay `font-src 'self'`.
- Every program's page uses the shared header: Athena name, a program switcher showing only programs you may open, your name, theme toggle, sign out.
- Contrast is checked in both themes (WCAG AA) as part of the UI tests.

## 4. Repositories and hosting

Recommendation: **fold LIBBY and the Mall's code into the `ATHENA` repo** as the monorepo and archive `MALL` (it holds only a one-line README).

```
athena/
  site/            home, shared/, admin/, lovelace/, lucien/, libby/   (libby/public moved here)
  functions/       Cloudflare Pages Functions: libby/*, admin/*        (libby/functions + libby/lib moved here)
  supabase/        one migration history, schemas: public (access, audit), lovelace, lucien, libby
  tracker/         Lucien collector
  scripts/         LIBBY's Python and Node jobs
  .github/         workflows from all three, prefixed by program
  docs/            this plan, adding-a-page, performance
```

- One Cloudflare Pages project serves `/` and the Functions. The LIBBY SPA is hash-routed, so mounting at `/libby/` needs only a base path and `/api/` → `/api/libby/` rewrites.
- Custom domain: one address for the lot. odysseus.org.uk either becomes Athena's domain or redirects `/` → Athena (decision 3).
- Old links keep working: `/mall/` → `/lovelace/`, `/ulysse/` → `/lucien/`, odysseus.org.uk paths → `/libby/…` via `_redirects`.

## 5. Database

- Decision needed (§7.1): **one Supabase project** (recommended) or LIBBY keeps its own.
- If one project: LIBBY's tables (`api_snapshots`, `bill_stakeholders`, `amendment_flags`, `todays_lists`, `people_roles`, …) move into a `libby` schema with RLS **added** (today LIBBY relies on the service-role key alone), data copied across, GitHub Actions secrets repointed.
- If two: LIBBY Functions verify Athena JWTs against Athena's JWKS and look up `access_grants` via a narrow RPC; two sets of secrets, two backups.
- Either way: `athena/supabase/migrations/` stays the single record; the check that fails CI when code uses a table the migrations do not create (LIBBY's `check-site.mjs`) is kept.

## 6. Phases

Each phase ends with something working and mergeable; nothing is switched off before its replacement is proven.

| # | Phase | Delivers | Done when |
|---|---|---|---|
| 0 | **Decide** | Answers to §7 | Open questions closed |
| 1 | **Shared design** | `libby.css` tokens, light + dark, theme toggle, shared header; restyle Athena home and `/admin/` | Home and admin pass UI tests in both themes |
| 2 | **Access core** | `programs`, `access_grants`, new `my_access()`, migration of existing roles, audit hooks, admin *People* tab | Admin can grant/revoke per program; old Mall roles intact; RLS tests pass |
| 3 | **Rename** | Mall → Lovelace, Ulysse → Lucien (paths, titles, copy, redirects, CSP, README, workflows) and apply the shared look | Old URLs redirect; all UI tests green in both themes |
| 4 | **Bring LIBBY in** | Code moved into `athena/`; sign-in via Athena; Functions verify JWT; levels read from `access_grants`; DB moved (or JWKS link) | LIBBY works for a Whip, Staff and Admin account with no shared passwords set |
| 5 | **LIBBY restyle** | LIBBY pages on the shared stylesheet with dark mode | Every LIBBY page reviewed in both themes |
| 6 | **Cut over** | Domain and redirects, shared-password secrets deleted, MALL archived, LIBBY repo archived | One URL; one login; old routes gone |
| 7 | **Tidy** | Single README, one `docs/adding-a-page.md` covering all programs, delegated management (optional) | New page can be added in one file |

Phases 1 and 2 can run in parallel. Phase 4 is the largest and riskiest.

## 7. Decisions I need from you

1. **One Supabase project or two?** Recommended: one (single identity, single backup, RLS on LIBBY data). It means migrating LIBBY's live data once.
2. **Break-glass admin.** Retire every shared password, or keep `ACCESS_ADMIN` as a hidden emergency door if Supabase Auth is down? Recommended: retire all, and rely on Supabase's own account recovery.
3. **Domain.** Does odysseus.org.uk become Athena's address, or does Athena get a new one and odysseus.org.uk redirect to `/libby/`?
4. **Who are LIBBY's real users?** Peers log in today with one shared password. Under this plan each needs an email address and an account (the admin can bulk-invite from a list). Are peers expected to have accounts, or should peers have a lighter route (e.g. a per-person magic link, no password)?
5. **Lucien levels.** The tracker has no tiers today (admin plus any role the admin opens it to). Is *Viewer / Editor / Manager* right, or is read-only enough?
6. **Names.** I have assumed Lovelace = the Mall renamed (campaign workspace) and Lucien = Ulysse renamed (policy and news tracker). Correct me if either is a new build rather than a rename.
7. **Delegation.** Should program leads (e.g. Lovelace core team) be able to manage their own program's people, or admin only?

## 8. Risks

| Risk | Mitigation |
|---|---|
| Locking out LIBBY's users during the move | Parallel run: both logins work until phase 6; accounts created and tested per role first |
| RLS added to LIBBY breaks a Function that assumed the service key | Functions keep the service-role key; RLS is the second line, tested with each level |
| Admin locks themselves out | Admin bound by email in `admins`; cannot be revoked via the API; recovery runbook written in phase 2 |
| LIBBY's strict list-parsing and snapshot jobs break on the move | Move code unchanged first (phase 4), restyle later (phase 5); `check-list.mjs` and `check-site.mjs` run in CI throughout |
| Dark mode on the leaflet look reads poorly | Design in phase 1 on the home and admin pages before touching LIBBY's 20+ views |
| Strict CSP breaks LIBBY (it uses Google Fonts and may use inline pieces) | Self-host fonts; CSP is tested by the existing UI harness (`tests/ui/run.js`), extended to LIBBY pages |
| Scheduled jobs fail after the repo move | Move workflows with their secrets, run each once by hand, then switch off the old ones |

## 9. Out of scope for now

New features in any program; replacing Claude drafting in LIBBY; SSO with an outside identity provider (can be added to Supabase Auth later without changing this design).
