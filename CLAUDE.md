# Notes for Claude Code working on Athena

- Tests: `python3 -m pytest -q tests`, `node tests/ui/run.js` (slow, about 3 minutes; run it in the background and wait), `node scripts/libby/check-site.mjs`, the other `node scripts/libby/check-*.mjs`, `node tests/contrast.js`, `node tests/libby-css.js`.
- Branch, test, push, open a PR with `gh api` (REST only); merge only when the owner says "merge".
- The Supabase project is `fbsoibmtvapmxdlfdgxc`; schema changes go in `supabase/migrations/` AND are applied live (MCP `apply_migration`).
- Access levels and what each opens: `site/libby/js/pages.js` (the source of truth for LIBBY pages and routes).

## If the owner shares a spreadsheet (or says "here's a sheet")

Read **`docs/IMPORTS.md`** first and follow its "For Claude Code" steps: run `node scripts/libby/check-import.mjs <the file>`, go through what it understood with the owner (ask about anything ambiguous), make the smallest fix in `site/shared/import/importers.js`, add a small version of the sheet to the self-tests, and say which pages still have no importer.
