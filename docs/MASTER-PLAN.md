# Athena master plan

Status: **decisions made, ready to build** · Drafted 2026-10-24, revised after answers the same day

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
- LIBBY's login screen, the six `ACCESS_*` passwords and the `lb_session` ticket are retired. No shared password is hard-wired any more.
- **Shared access codes replace them (§3.5):** the admin can create a single basic password for a program and level whenever wanted. Peers can either make their own account or use such a code.

### 3.2 Access: program × level × expiry

New, program-agnostic tables replace the Mall-only `profiles.role`:

- `programs` — `lovelace`, `lucien`, `libby`, `admin`.
- `program_levels` — the levels each program offers, ordered:
  - Lovelace keeps its six roles (Core team … Member) and the existing `role_permissions` grid.
  - Lucien: unchanged from Ulysse. It has no levels: a person either has access or does not (today: the admin, plus any role the admin opens it to). Same pages, same functions.
  - LIBBY keeps its six levels (Peer, Whip, Spokesperson, Leader's office, Staff, Admin) and their ranks.
- `access_grants (user_id, program, level, is_manager, expires_at, granted_by, granted_at)` — one row per person per program. `is_manager` is the **program manager** tier (§3.3). A person can be a Whip in LIBBY, a Candidate in Lovelace and have no Lucien access.
- `my_access()` returns every grant that has not expired; the home page, each program and the database all read from it.
- Existing guard rails carry over, now per program: nobody edits their own grant; only the admin grants admin-level or program manager; the admin account cannot be changed by anyone else; the admin's own access cannot be switched off.
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
- **Program manager (new tier, below admin):** a person the admin marks as manager of one program (or several). They can, **for that program only**:
  - see its people, and grant, change or revoke levels and access-until dates;
  - invite people by email;
  - create and revoke that program's shared access codes (§3.5), up to a ceiling level the admin sets.

  They cannot: grant or remove manager status, touch an admin or another manager's grant, change their own grant, see other programs' people, or open the master console. The admin alone does those. Every action is audited.
  - Lovelace today lets the core team manage *Team & access* and make other core-team members. That right becomes program-manager for Lovelace, given by the admin. Lucien, whose access only the admin could open to a role, gets a manager the same way.
- You said "preferably through the back-channels, otherwise my own account": the back-channel is `/admin/` signed in as the admin account; there is no second route.

### 3.5 Shared access codes (one-password access)

For when a group should get in with one basic password and no individual account (Peers now; other groups later; Lovelace is not Peers-only):

- The admin (or a program manager, within their ceiling) creates a code in `/admin/`: a **label** ("Peers", "Lovelace volunteers"), the **program**, the **level**, an optional **expiry**, and an optional **maximum number of uses**. The password is shown once; only a hash is stored.
- Anyone can be given a code, change it (rotate), or switch it off at any time. Switching off or rotating signs out everyone who used it, as the LIBBY passwords did.
- Signing in with a code is a field on the same sign-in page: "Use an access code instead". A Function checks the hash and issues a session limited to that program and level.
- Same guessing protection as LIBBY (10 wrong tries in 15 minutes pauses that connection; only a keyed hash of the address is kept).
- Trade-offs, stated plainly: code sessions are **not individuals**. The audit log shows "Peers code" rather than a name; per-person features (Lucien's read/unread state, a person's duty-whip entry) are shared across everyone on that code; and a leaked code works for whoever has it until rotated. Peers who want any of those things make their own account, which stays the default offered.
- Codes can never carry admin or program-manager level.

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
- **Address: `athena.odysseus.org.uk`**, a new subdomain pointed at the Athena Pages project. **`odysseus.org.uk` itself is not touched:** no DNS change to the apex, no change to its Pages project, and LIBBY keeps serving there exactly as now until the admin says otherwise. Only a new record for `athena` is added.
- Because LIBBY lives in two places for a while, the old copy at odysseus.org.uk keeps its own login until the admin chooses to retire it (phase 6, optional). What happens to the apex afterwards (stay as is, or redirect to `athena.odysseus.org.uk/libby/`) is the admin's call at that point.
- Old links keep working: `/mall/` → `/lovelace/`, `/ulysse/` → `/lucien/` via `_redirects`.

## 5. Database

- **One Supabase project** (decided). LIBBY's tables (`api_snapshots`, `bill_stakeholders`, `amendment_flags`, `todays_lists`, `people_roles`, …) move into a `libby` schema with RLS **added** (today LIBBY relies on the service-role key alone), data copied across, GitHub Actions secrets repointed. LIBBY's original project is left untouched until the copy is verified, so the live odysseus.org.uk site keeps working throughout.
- `athena/supabase/migrations/` stays the single record; the check that fails CI when code uses a table the migrations do not create (LIBBY's `check-site.mjs`) is kept.

## 6. Phases

Each phase ends with something working and mergeable; nothing is switched off before its replacement is proven.

| # | Phase | Delivers | Done when |
|---|---|---|---|
| 0 | **Decide** | Answers to §7 | Open questions closed |
| 1 | **Shared design** (built, on branch `master-plan`) | `libby.css` tokens, light + dark, theme toggle, shared header; restyle Athena home and `/admin/` | Home and admin pass UI tests in both themes |
| 2 | **Access core** (database built and tested; not yet applied to the live project; admin People and Access codes screens still to build) | `programs`, `access_grants`, program-manager tier, `access_codes`, new `my_access()`, migration of existing roles, audit hooks, admin *People* and *Access codes* tabs | Admin can grant/revoke per program; a manager can manage only their program; a code signs in at its level and no higher; old Mall roles intact; RLS tests pass |
| 3 | **Rename** | Mall → Lovelace, Ulysse → Lucien (paths, titles, copy, redirects, CSP, README, workflows) and apply the shared look | Old URLs redirect; all UI tests green in both themes |
| 4 | **Bring LIBBY in** | Code moved into `athena/`; sign-in via Athena; Functions verify JWT; levels read from `access_grants`; data copied to the Athena project | LIBBY at `athena.odysseus.org.uk/libby/` works for a Whip, Staff and Admin account, and for a Peer via own account and via a Peers code; odysseus.org.uk unaffected |
| 5 | **LIBBY restyle** | LIBBY pages on the shared stylesheet with dark mode | Every LIBBY page reviewed in both themes |
| 6 | **Cut over** | `athena.odysseus.org.uk` live, old shared passwords deleted from the new site, MALL archived. Optional, only if the admin asks: retire the old copy at odysseus.org.uk | One URL; one login; old routes redirect; odysseus.org.uk exactly as the admin left it |
| 7 | **Tidy** | Single README, one `docs/adding-a-page.md` covering all programs | New page can be added in one file |

Phases 1 and 2 can run in parallel. Phase 4 is the largest and riskiest.

## 7. Decisions

**Made**

| # | Decision |
|---|---|
| 1 | One Supabase project. |
| 2 | All current shared passwords retired. The admin can create new single-password access codes at any time (§3.5). |
| 3 | Address is `athena.odysseus.org.uk`. odysseus.org.uk and its current LIBBY site are left untouched. |
| 4 | Peers may make their own accounts, and a one-password code remains available for Peers and, later, other groups. |
| 5, 6 | Lovelace is the Mall renamed; Lucien is Ulysse renamed, with the same functions and access. |
| 7 | New *program manager* tier, below admin, managing their own program's people. |

**Still open (small; I will use the default unless told otherwise)**

| Question | Default |
|---|---|
| Where is the DNS for odysseus.org.uk hosted? Adding the `athena` record needs access to it. | If Cloudflare, I'll give you the one CNAME to add; nothing else changes |
| Can a program manager create access codes, and up to what level? | Yes, up to a ceiling the admin sets per manager, never manager or admin |
| Who is the first program manager of each program? | None until you name them; you remain the only one with these rights |
| Bulk-invite Peers by email (account route)? | Yes, from a pasted list in `/admin/`; Peers who do not want accounts use the code |

## 8. Risks

| Risk | Mitigation |
|---|---|
| Locking out LIBBY's users during the move | The old odysseus.org.uk site is never changed; the new one runs in parallel and people move when ready |
| A shared code leaks | Rotate or switch off in one click; expiry and use limits; codes cannot reach manager or admin level; rate-limited |
| A program manager over-reaches | Rules are enforced in the database, not the page, and tested: wrong program, own grant, admin, manager grants all refused |
| RLS added to LIBBY breaks a Function that assumed the service key | Functions keep the service-role key; RLS is the second line, tested with each level |
| Admin locks themselves out | Admin bound by email in `admins`; cannot be revoked via the API; recovery runbook written in phase 2 |
| LIBBY's strict list-parsing and snapshot jobs break on the move | Move code unchanged first (phase 4), restyle later (phase 5); `check-list.mjs` and `check-site.mjs` run in CI throughout |
| Dark mode on the leaflet look reads poorly | Design in phase 1 on the home and admin pages before touching LIBBY's 20+ views |
| Strict CSP breaks LIBBY (it uses Google Fonts and may use inline pieces) | Self-host fonts; CSP is tested by the existing UI harness (`tests/ui/run.js`), extended to LIBBY pages |
| Scheduled jobs fail after the repo move | Move workflows with their secrets, run each once by hand, then switch off the old ones |

## 9. Out of scope for now

New features in any program; replacing Claude drafting in LIBBY; SSO with an outside identity provider (can be added to Supabase Auth later without changing this design).
