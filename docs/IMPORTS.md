# Spreadsheet import

Every page where data is typed in has an **Import from a spreadsheet** box (folded away at the top): Issues Tracker, Roles, the Bulletin editor, and Access (invite many people). Choose an Excel or CSV file; the page reads it **in the browser**, matches the columns to its fields **by their headings** (and, for dates, links and emails, by what the cells look like), shows a table of what it understood (with a drop-down on each field to correct it) and a list of the rows it will add and the rows it cannot use, and only saves when **Add** is pressed. There is a "Download a blank template" link, but the point is that nobody has to: your own headings are fine.

## Where things are

| File | What it does |
|---|---|
| `site/shared/import/sheet.js` | Reads the file (finds the heading row under a title), scores headings against fields, sniffs columns by contents, reads dates (day-first, Excel numbers, written forms). No page code. |
| `site/shared/import/importers.js` | **One entry per page**: its fields (with `aliases`, the headings it recognises), the words it understands (`KIND_WORDS`, `ROLE_WORDS`, portfolios), and `resolve()`, which turns a row into an entry or a reason it was refused. |
| `site/shared/import/panel.js` | The folded box on the screen: file, mapping drop-downs, preview, Add. |
| the page's own file (`issues-page.js`, `roles-page.js`, `bulletin-editor-page.js`, `access/access.js`) | The `commit` function: saves the good rows with that page's existing API calls (so access rules are unchanged), skipping what is already there. |
| `scripts/libby/check-import.mjs` | Self-tests (run in CI), and the tool below for looking at a real sheet. |

## For Claude Code: when the owner shares a sample sheet

Do this, in order:

1. **Run the reader on it:** `node scripts/libby/check-import.mjs path/to/sheet.xlsx` (or `--importer issues`). It prints the sheet and heading row it found, then for every importer which column fills which field (and whether by heading or by contents), the columns nothing took, the rows it would add and the rows it would refuse with the reason. The importer with the highest `fit` is the page the sheet is for.
2. **Read the output with the owner, not at them.** Say which page the sheet seems to be for and why; list the columns that matched confidently, the ones that matched by contents (less sure), and the columns nothing took. **Ask** about anything ambiguous before changing code: what an unmatched column means, whether a column should become a field, how to read an odd value (a status word, a person's name in a mixed cell, a date written in words), what should happen to duplicates and to rows that already exist.
3. **Choose the smallest fix that makes the sheet work**, in this order of preference:
   - a heading the page does not know → add it to that field's `aliases` in `importers.js`;
   - a value it does not understand → add it to `KIND_WORDS` / `ROLE_WORDS` or to the portfolio matching;
   - a column that carries information the page has nowhere to put → propose a new field (and, if needed, a database column and the page's `commit`) and ask first;
   - a sheet for a page with no importer yet → add an importer in `importers.js` (fields + `resolve`), then a `commit` and a `mountImport(...)` in the page, following `issues-page.js`. Pages still without one: Whip availability and the duty rota (a grid of names by day), room bookings, Bill advisers and leads (match Bills by title), groupings, LOVELACE plan entries and visits, the Stats calendar's manual dates. Ask which the owner wants next.
   - a messy document (a Word minute, a PDF, an email) rather than a sheet → this system is deliberately not an AI reader. Say so, and offer the other option the owner was given earlier: a "read anything" upload where Claude extracts the entries and shows a preview.
4. **Prove it:** put a small version of the owner's sheet (headings and a few rows, names changed if they are personal) into the self-tests in `scripts/libby/check-import.mjs` so the shape keeps working, and run `node scripts/libby/check-import.mjs` and `node tests/ui/run.js`.
5. **Never loosen a safety.** Rows with a fatal problem (no date, unknown portfolio, bad email, unknown role) are refused, not guessed; nothing is saved before the owner presses Add; existing entries are left as they are (duplicates are skipped, not overwritten). Keep it that way unless the owner asks otherwise.

## Things that are easy to get wrong

- **CSV dates.** The spreadsheet library would read `05/10/2026` as 10 May. `readWorkbook` tells it to leave a CSV's cells as written, and the date reader is day-first. A real Excel file has true dates and is read as they are.
- **Title rows.** Many real sheets have a title or blank rows above the headings; the heading row is found, not assumed to be row 1.
- **Merged or grouped cells.** The Issues importer fills a blank campaign or portfolio from the row above (`fillDown`). Do the same for any new field that is written once per group.
- **"Staff" roles.** A role cell saying just "Staff" is read as Leader's circle's Staff (the old Staff); "Whip's Staff", "Frontbencher Staff" and so on go with their principal.
