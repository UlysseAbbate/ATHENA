# Governance, data protection and continuity

Written during the November 2026 review. It records how the site is run, what personal data it holds and why, and the actions that only the owner can take. It is a working document, not legal advice: have the data-protection sections checked by whoever is responsible for data protection in your organisation.

## Who is responsible for what

| Role | Who | Responsible for |
|---|---|---|
| Owner | The repository owner | The site as a whole; approving accounts; the only person with access to every program and the back end; merging changes. |
| Administrators | Named on the Access page | Approving accounts, levels and codes for their program; removing access when someone leaves. |
| Program managers | Set per program on the Access page | Day-to-day access for their program, up to their ceiling. |
| Everyone with access | | Following the acceptable-use rules on `/privacy/`. |

Access is reviewed by the owner **every three months** (Access page, Everyone tab): remove people who have left, end codes that are no longer needed, check nobody holds a higher level than their work needs.

## Change control

Every change is made on a branch, runs the automated checks, is opened as a pull request and is merged only when the owner says so. Database changes are written as migrations in `supabase/migrations/` and applied to the live database at the same time. The checks are listed in `CLAUDE.md`.

## Personal data held (record of processing)

| Data | Where | Whose | Why | Seen by | Kept |
|---|---|---|---|---|---|
| Accounts: email, name, password hash, access levels, last sign-in | Supabase Auth, `profiles`, `access_grants`, `access_invites` | People using the site | To sign in and control access | Administrators, program managers | Until the person no longer needs access |
| Activity log: who changed which entry and when (no contents) | `audit_log` | People using LOVELACE | Accountability | Roles with "Activity log" | Review yearly; delete entries over two years old |
| Failed code sign-ins: keyed hash of the connection | `login_failures` | Anyone trying a code | To slow guessing | Server only | Deleted after a day |
| Contacts and stakeholders: name, organisation, email, phone, notes | `contacts`, `stakeholders`, `bill_stakeholders` | Outside contacts | The team's working relationships | LOVELACE / LIBBY at the right level | While the relationship is live; review yearly |
| Volunteers: name, email, phone, availability, notes | `volunteers` | Volunteers | Organising volunteers | LOVELACE at the right level | While they volunteer, then delete |
| Work experience and Ask a Parliamentarian requests | `work_experience_*`, `ask_*` | Applicants, staff | Matching requests to offers | LIBBY | Delete when dealt with; review each term |
| Roles, rotas, availability, room bookings, names on notes and entries | `people_roles`, `duty_whips`, `whip_availability`, `room_bookings`, and name fields across LIBBY | Parliamentarians and staff | Running the Whips' Office and POLD work | LIBBY at the right level | While current |
| Questions asked on Parliamentary process, with the asker's name | `process_questions` | Staff | A shared record of answers | Whips and above | Until deleted by Staff |

**Special-category data.** The site supports a political party's work, so a record that someone is a volunteer, member or supporter reveals a political opinion. That is special-category data under UK GDPR. Keep such records to what is needed, restrict them to the people who need them, and make sure the organisation's own privacy notice to volunteers and contacts covers their being recorded here.

**Lawful basis (to be confirmed by the organisation):** legitimate interests for working contacts and staff records; for volunteers and supporters, the political-party conditions in the Data Protection Act 2018 (Schedule 1) or consent.

**Processors.** Supabase (database and sign-in), Cloudflare (hosting), GitHub (code and scheduled jobs; no personal data beyond public sources) and Anthropic (text sent when an AI button is pressed). Check that each has a data-processing agreement accepted on the account, and note the region the Supabase project is in; transfers outside the UK need the provider's standard safeguards.

**Requests from individuals** (to see, correct or delete their data) go to the owner and are answered within one month. Deleting a person on the Access page removes their account and grants; records about outside people are deleted on the page that holds them.

**A personal-data breach** (data seen, lost or changed by someone who should not have) must be assessed by the owner at once and, if it is likely to put people at risk, reported to the ICO within 72 hours.

## Use of AI

Claude is used only when a person presses a button (drafts, summaries, suggested questions, procedure answers) and in the scheduled policy indexing of published documents. Answers show their sources and are saved with the name of the person who asked. People are told on `/privacy/` not to enter personal or confidential details and to check answers before relying on them.

## If something goes wrong

1. **An account or code may be compromised:** switch the code off or delete the account on the Access page (takes effect within 30 seconds); change the password.
2. **A secret may have leaked** (Supabase service key, `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `INGEST_TOKEN`): make a new one at the provider, put it in Cloudflare Pages / GitHub secrets / Supabase function secrets, redeploy, then revoke the old one.
3. **The site is broken after a change:** in Cloudflare Pages, roll back to the previous deployment; then revert the merge on GitHub.
4. **Data was deleted or damaged:** restore from the latest Supabase backup (see below).
5. Write down what happened, what was affected and what was done; decide whether it is a reportable breach.

## Continuity

- **Code:** on GitHub; every deployment can be rolled back in Cloudflare Pages.
- **Database:** depends on the Supabase plan. The free plan keeps no downloadable backups; a paid plan keeps daily backups. Until backups are confirmed, treat the database as unprotected against accidental deletion (see actions below).
- **Public data** (Parliament, think tanks, polls, statistics) can always be rebuilt by running the workflows.
- **Single point of failure:** the owner. A second trusted person should know where the accounts are and how to follow section "If something goes wrong".

## Actions for the owner

These cannot be done from the code.

1. **Turn on leaked-password protection** in Supabase (Authentication → Providers → Email). Supabase's own checker flags this as off.
2. **Turn on two-step sign-in** on the accounts that control the site: GitHub, Cloudflare, Supabase and Anthropic. Consider requiring it for administrators of the site itself (Supabase supports authenticator-app codes; it would need a small change here).
3. **Confirm database backups** (Supabase plan), or ask for a scheduled export to be added.
4. **Protect the `main` branch** on GitHub: require the checks to pass before merging, and no direct pushes.
5. **Check the tokens:** `GITHUB_TOKEN` in Cloudflare should be a fine-grained token for this one repository with only "Actions: read and write"; set a yearly reminder to renew every secret.
6. **Spending limits:** set a monthly limit on the Anthropic account so a mistake or misuse cannot run up a bill.
7. **Data protection:** confirm who the data controller is, that it is registered with the ICO, and that its privacy notice covers this site; accept the processors' data-processing agreements; have `/privacy/` checked.
8. **Update the spreadsheet library** (`site/libby/vendor/xlsx.full.min.js`, version 0.18.5). Newer versions fix two known weaknesses in reading hostile files. Only signed-in staff can import a sheet and it is read in their own browser, so the risk is low, but it should be replaced with 0.20.3 from SheetJS's own site (it is no longer published where the other libraries come from).
9. **Quarterly access review** and **yearly retention review** as set out above.
