#!/usr/bin/env node
// Copies LIBBY's existing rows from its old Supabase project into the Athena project (master plan, phase 4).
// Safe to re-run: rows are merged on their primary key, nothing is deleted anywhere, and the old project is only READ.
//
//   OLD_SUPABASE_URL=https://old.supabase.co OLD_SERVICE_KEY=...  NEW_SUPABASE_URL=https://fbsoibmtvapmxdlfdgxc.supabase.co NEW_SERVICE_KEY=... \
//     node scripts/libby/copy-data.mjs [--dry-run] [--only table,table]
//
// Run it after supabase/migrations/20261024110000_libby_tables.sql has been applied to the Athena project.
// api_snapshots (the saved copies of Parliament data) and login_failures are not copied: the refresh job rebuilds them.

const { OLD_SUPABASE_URL, OLD_SERVICE_KEY, NEW_SUPABASE_URL, NEW_SERVICE_KEY } = process.env;
const dry = process.argv.includes('--dry-run');
const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
if (!OLD_SUPABASE_URL || !OLD_SERVICE_KEY || !NEW_SUPABASE_URL || !NEW_SERVICE_KEY) {
  console.error('Set OLD_SUPABASE_URL, OLD_SERVICE_KEY, NEW_SUPABASE_URL and NEW_SERVICE_KEY.');
  process.exit(2);
}
if (OLD_SUPABASE_URL.replace(/\/$/, '') === NEW_SUPABASE_URL.replace(/\/$/, '')) { console.error('The old and new projects are the same: nothing to copy.'); process.exit(2); }

// Parents before the tables that refer to them. `drop` lists columns the database computes itself and will not accept.
const TABLES = [
  ['policy_documents', 'id'], ['policy_chunks', 'id', ['tsv']],
  ['whips_business', 'id'], ['whips_snapshots', 'id'], ['whatson_events', 'id'], ['oq_suggestions', 'id'], ['bill_advisers', 'id'],
  ['amendment_comments', 'id'], ['groupings', 'id'], ['amendment_descriptions', 'id'], ['comms_posts', 'id'], ['lords_divisions', 'id'],
  ['duty_whips', 'id'], ['whip_availability', 'id'], ['hymn_sheets', 'id'], ['hymn_sheet_files', 'id'], ['bulletin_messages', 'id'],
  ['room_series', 'id'], ['room_bookings', 'id'], ['bill_stakeholders', 'id'], ['bill_stakeholder_files', 'id'], ['amendment_flags', 'id'],
  ['people_roles', 'id'], ['todays_lists', 'id'], ['site_settings', 'key'],
];
const PAGE = 500;
const hdr = (key) => ({ apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' });
const base = (u) => u.replace(/\/$/, '') + '/rest/v1';

async function readAll(table, pk) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(`${base(OLD_SUPABASE_URL)}/${table}?select=*&order=${pk}.asc`, { headers: { ...hdr(OLD_SERVICE_KEY), range: `${from}-${from + PAGE - 1}`, 'range-unit': 'items' } });
    if (!res.ok) throw new Error(`reading ${table}: ${res.status} ${await res.text()}`);
    const got = await res.json();
    rows.push(...got);
    if (got.length < PAGE) return rows;
  }
}

async function writeAll(table, pk, rows) {
  for (let i = 0; i < rows.length; i += 200) {
    const res = await fetch(`${base(NEW_SUPABASE_URL)}/${table}?on_conflict=${pk}`, {
      method: 'POST', headers: { ...hdr(NEW_SERVICE_KEY), prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows.slice(i, i + 200)) });
    if (!res.ok) throw new Error(`writing ${table}: ${res.status} ${await res.text()}`);
  }
}

let problems = 0;
for (const [table, pk, drop = []] of TABLES) {
  if (only.length && !only.includes(table)) continue;
  try {
    const rows = (await readAll(table, pk)).map((r) => { for (const d of drop) delete r[d]; return r; });
    if (!dry) await writeAll(table, pk, rows);
    console.log(`${dry ? 'would copy' : 'copied'}  ${String(rows.length).padStart(6)}  ${table}`);
  } catch (e) { problems++; console.log(`FAILED  ${table}: ${e.message}`); }
}
if (!dry && !only.length) {
  const res = await fetch(`${base(NEW_SUPABASE_URL)}/rpc/libby_reset_sequences`, { method: 'POST', headers: hdr(NEW_SERVICE_KEY), body: '{}' });
  console.log(res.ok ? 'id counters moved past the copied rows' : `FAILED  id counters: ${res.status} ${await res.text()}`);
  if (!res.ok) problems++;
}
process.exit(problems ? 1 : 0);
