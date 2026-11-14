// Spreadsheet import: the checker and the tool for looking at a real sheet.
//   node scripts/libby/check-import.mjs                  self-tests (run in CI): how headings are matched, dates and roles read, rows grouped
//   node scripts/libby/check-import.mjs path/to/sheet.xlsx [--importer issues]
//        shows how every importer (or just the one named) would read that file: the sheet and header row found, which column fills which field and how
//        (heading or contents), the columns nothing took, the rows that would be added and the rows that would be refused and why.
// If the owner shares a sample sheet with Claude Code, THIS is the first thing to run on it. docs/IMPORTS.md says what to do with the output.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { readWorkbook, matchColumns, parseDate, headerScore } from '../../site/shared/import/sheet.js';
import { IMPORTERS, analyse, readWithAll, kindOf, roleOf, portfolioOf, whenOf, platformOf, handleOf } from '../../site/shared/import/importers.js';
import { PORTFOLIOS } from '../../lib/libby/portfolios.js';
import { ROLE_ORDER, LEVEL_NAMES } from '../../lib/libby/access.js';

const XLSX = createRequire(import.meta.url)('../../site/libby/vendor/xlsx.full.min.js');
const ROLES = ROLE_ORDER.map((id) => ({ id, label: LEVEL_NAMES[id] }));
const LEVELS = { lovelace: [{ level: 'core_team', label: 'Core team' }, { level: 'candidate', label: 'Candidate' }], lucien: [{ level: 'access', label: 'Access' }], libby: ROLE_ORDER.map((id) => ({ level: id, label: LEVEL_NAMES[id] })) };
const LOOKUPS = {
  portfolios: PORTFOLIOS.map((p) => ({ code: p.code, name: p.name })), roles: ROLES,
  programs: [{ id: 'lovelace', name: 'LOVELACE' }, { id: 'lucien', name: 'LUCIEN' }, { id: 'libby', name: 'LIBBY' }], levels: LEVELS, fixedProgram: 'libby',
};

const args = process.argv.slice(2);
if (args.length && !args[0].startsWith('--')) {
  const file = args[0];
  const only = args.includes('--importer') ? args[args.indexOf('--importer') + 1] : '';
  const book = readWorkbook(XLSX, new Uint8Array(fs.readFileSync(file)));
  console.log(`${file}: ${book.sheets.length} usable sheet(s)\n`);
  for (const sheet of book.sheets) {
    console.log(`=== Sheet "${sheet.name}": ${sheet.rows.length} rows; headings: ${sheet.headers.map((h, i) => `[${i}] ${h || '(blank)'}`).join(' | ')}`);
    console.log('    first row:', JSON.stringify(sheet.rows[0]).slice(0, 300));
    for (const r of readWithAll(sheet, LOOKUPS).filter((x) => !only || x.importer.id === only)) {
      const { importer, match, fit, result } = r;
      console.log(`\n  -- ${importer.id} (${importer.title}): fit ${fit.toFixed(0)}; ${result.counts.ok} rows ready, ${result.counts.fatal} refused, ${result.skipped} empty`);
      for (const fld of importer.fields) {
        const c = match.mapping[fld.key];
        console.log(`     ${fld.label.padEnd(22)} ${fld.required ? '(needed) ' : '         '}${c >= 0 ? `<- [${c}] "${sheet.headers[c]}" (by ${match.how[fld.key]})` : '<- nothing'}`);
      }
      if (match.unmatched.length) console.log(`     columns nothing took: ${match.unmatched.map((c) => `[${c}] "${sheet.headers[c]}"`).join(', ')}`);
      for (const e of result.entries.filter((x) => x.problems.length).slice(0, 8)) console.log(`     row ${e.row}: ${e.fatal ? 'REFUSED' : 'warning'}: ${e.problems.join('; ')}`);
      for (const e of result.entries.filter((x) => !x.fatal).slice(0, 3)) console.log(`     row ${e.row} reads as: ${e.summary}`);
    }
    console.log('');
  }
  process.exit(0);
}

/* ------------------------------------------------------------------ self-tests */
let failed = 0;
const ok = (cond, name) => { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}`); if (!cond) failed++; };
const csv = (text) => readWorkbook(XLSX, new TextEncoder().encode(text));

ok(parseDate('05/10/2026') === '2026-10-05' && parseDate('5 Oct 2026') === '2026-10-05' && parseDate('Tuesday 5th October 2026') === '2026-10-05' && parseDate('2026-10-05') === '2026-10-05' && parseDate('5-Oct-26') === '2026-10-05' && parseDate('46300') === '2026-10-05', 'dates are read day-first and in the usual written forms, and as Excel day numbers');
ok(parseDate('31/02/2026') === '' && parseDate('hello') === '' && parseDate('') === '', 'and things that are not dates are not');
ok(headerScore('Date of action', IMPORTERS.issues.fields.find((f) => f.key === 'date')) >= 80 && headerScore('Dte', IMPORTERS.issues.fields.find((f) => f.key === 'date')) === 0 && headerScore('Hansard link', IMPORTERS.issues.fields.find((f) => f.key === 'url')) >= 80, 'headings are matched loosely (a longer heading containing the word, a known alias)');
ok(kindOf('OQ') === 'oral-question' && kindOf('Written PQ') === 'written-question' && kindOf('Westminster Hall debate') === 'debate' && kindOf('Amendment at Committee') === 'amendment' && kindOf('Press release') === 'media' && kindOf('Coffee') === 'other' && kindOf('') === '', 'a kind of action is read from the words used');
ok(roleOf('Whip', ROLES) === 'whips' && roleOf("Whip's Staff", ROLES) === 'whips_staff' && roleOf('Spokesperson', ROLES) === 'frontbench' && roleOf('Backbencher', ROLES) === 'backbench' && roleOf("Leader's circle", ROLES) === 'leader' && roleOf('Administrator', ROLES) === 'admin' && roleOf('Frontbencher parliamentarian’s Staff', ROLES) === 'frontbench_staff' && roleOf('astronaut', ROLES) === '', 'a role is read from the words used (and "staff" goes with its principal)');
ok(portfolioOf('DEFRA', LOOKUPS.portfolios)?.code && portfolioOf('Home Office', LOOKUPS.portfolios) && !portfolioOf('Narnia', LOOKUPS.portfolios), 'a portfolio is read from its code or its name');

// a messy campaign sheet: a title above the headings, own wording, dates as written, the campaign only on the first row of its group
const issuesCsv = csv(`Lib Dem Lords: campaigns tracker,,,,,,,
,,,,,,,
Brief,Campaign,What we did,When,Type,Hansard,Who,Notes
Environment,Water company regulation,Oral Question on sewage discharges,05/10/2026,OQ,https://hansard.parliament.uk/lords/2026-10-05/x,Baroness Beta,Minister promised a review
,,Amendment 14 to the Water Bill,2 Nov 2026,Amendment,,Lord Alpha,
Home Office,Asylum backlog,,,,,,
Home Office,Asylum backlog,Debate on the Asylum Bill,not a date,Debate,www.example.org/x,Baroness Beta,`);
const sh = issuesCsv.sheets[0];
ok(sh.headers[0] === 'Brief' && sh.rows.length === 4, 'the headings are found under a title row, and empty rows are dropped');
const m = matchColumns(sh.headers, sh.rows, IMPORTERS.issues.fields);
ok(m.mapping.portfolio === 0 && m.mapping.issue === 1 && m.mapping.what === 2 && m.mapping.date === 3 && m.mapping.kind === 4 && m.mapping.url === 5 && m.mapping.parliamentarian === 6 && m.mapping.notes === 7, 'a sheet in the user\'s own words is matched column by column');
const res = analyse(sh, IMPORTERS.issues, LOOKUPS, m.mapping);
const e0 = res.entries[0].entry, e1 = res.entries[1].entry;
ok(res.entries.length === 4 && e0.portfolio === portfolioOf('Environment', LOOKUPS.portfolios)?.code && e0.issue === 'Water company regulation' && e0.action.date === '2026-10-05' && e0.action.kind === 'oral-question', 'a row is read into a campaign and an action');
ok(e1.issue === 'Water company regulation' && e1.portfolio === e0.portfolio && e1.action.kind === 'amendment' && e1.action.date === '2026-11-02', 'blank campaign and portfolio cells take the one above');
ok(res.entries[2].entry.action === null && !res.entries[2].fatal, 'a row with a campaign and no action just makes the campaign');
ok(res.entries[3].fatal && /not a date|No date/.test(res.entries[3].problems.join(';')) && /www\.example\.org/.test(res.entries[3].entry.action.url || 'www.example.org') , 'a row with a bad date is refused, with the reason');

// a real Excel file: date cells are true dates (not guessed from text), whatever the way they are shown
const xl = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(xl, XLSX.utils.aoa_to_sheet([['Campaign', 'Portfolio', 'What', 'Date'], ['Rail fares', 'Transport', 'Question', new Date(2026, 9, 5)]], { cellDates: true }), 'Sheet1');
const xb = readWorkbook(XLSX, new Uint8Array(XLSX.write(xl, { type: 'array', bookType: 'xlsx', cellDates: true })));
ok(xb.sheets[0] && parseDate(xb.sheets[0].rows[0][3]) === '2026-10-05', 'a date cell in a real Excel file is read as that date');

// the right importer is found from the headings alone
const rolesBook = csv('Person,Position,Chamber\nBaroness Beta,Whip,Lords\nDaisy Cooper,Spokesperson,Commons\nPat Staffer,Leader\'s circle\'s Staff,\nNobody,Astronaut,Lords');
const all = readWithAll(rolesBook.sheets[0], LOOKUPS);
ok(all[0].importer.id === 'roles', 'a sheet of people and positions is recognised as a Roles sheet');
const rr = all[0].result;
ok(rr.entries[0].entry.role === 'whips' && rr.entries[1].entry.role === 'frontbench' && rr.entries[1].entry.house === 'commons' && rr.entries[2].entry.role === 'leader_staff' && rr.entries[3].fatal, 'roles are read from the words, with the House, and an unknown role is refused');
const invBook = csv('E-mail address,Access level,Valid until\nnew.person@example.org,Whip,31/12/2026\nbad-address,Whip,\nsomeone@example.org,Wizard,');
const iv = readWithAll(invBook.sheets[0], LOOKUPS);
ok(iv[0].importer.id === 'invites' && iv[0].result.entries[0].entry.level === 'whips' && iv[0].result.entries[0].entry.until === '2026-12-31' && iv[0].result.entries[1].fatal && iv[0].result.entries[2].fatal, 'a sheet of emails and levels is recognised as invites; a bad address or level is refused');
const bulBook = csv('Headline,Text\nRecess dates,The House rises on Thursday.\n,Second message with no heading');
ok(readWithAll(bulBook.sheets[0], LOOKUPS)[0].importer.id === 'bulletin' && readWithAll(bulBook.sheets[0], LOOKUPS)[0].result.counts.ok === 2, 'a sheet of headings and texts is recognised as bulletin messages');

// a Concessionometer sheet (the Staff's own: season instead of a date, several portfolios in a cell, extra columns that are ignored)
const concBook = csv(`Date,Concession Name,Bill/Legislation,Portfolio/Department,Importance,Rating,Details
Summer 2025,Kinship care ,Armed Forces Commissioner Bill,"Defence, DHSC",4,****,Julie Smith pressed the Government.
Winter 2025,Employment law,Employment Rights Bill ,DBT,4,****,Six-month window.
Spring 2026,Odd one,Some Bill,"Narnia, Education",2,**,
Someday,Bad date,Another Bill,DfT,1,*,
,,,,,,`);
const cc = readWithAll(concBook.sheets[0], LOOKUPS);
ok(cc[0].importer.id === 'concessions', 'a sheet of concession names, Bills and details is recognised as Concessionometer rows');
const ce = cc[0].result.entries;
ok(ce[0].entry.bill === 'Armed Forces Commissioner Bill' && ce[0].entry.name === 'Kinship care' && ce[0].entry.portfolio.join() === 'MOD,DHSC' && ce[0].entry.period === 'Summer 2025' && ce[0].entry.wonAt === '2025-06-01' && /pressed/.test(ce[0].entry.notes), 'a concession is read: Bill, name, several portfolios, the season as a date and as the words, the details as notes');
ok(!ce[2].fatal && ce[2].entry.portfolio.join() === 'DFE' && /Narnia/.test(ce[2].problems.join()) && !ce[3].fatal && ce[3].entry.wonAt === '' && /not a date/.test(ce[3].problems.join()), 'an unknown portfolio or date is left out with a warning; the row is still added');
ok(whenOf('Autumn 2025').date === '2025-09-01' && whenOf('5 Oct 2026').date === '2026-10-05' && whenOf('5 Oct 2026').period === '' && whenOf('') .date === '' && whenOf('later') === null, 'seasons and dates are read for "date won"');


// LOVELACE tracked accounts: an owner and a link; the platform and handle come from the link
ok(platformOf('https://bsky.app/profile/sarah.bsky.social') === 'BlueSky' && platformOf('www.instagram.com/londonlibdems/') === 'Instagram' && platformOf('https://x.com/sarahjolney1') === 'Twitter' && platformOf('https://example.org/x') === '', 'a profile link gives its platform');
ok(handleOf('BlueSky', 'https://bsky.app/profile/sarah.bsky.social') === 'sarah.bsky.social' && handleOf('Instagram', 'https://www.instagram.com/londonlibdems/') === 'londonlibdems' && handleOf('Substack', 'https://sarah.substack.com/') === 'sarah.substack.com' && handleOf('Twitter', 'https://x.com/a', '@given') === 'given', 'and its handle');
const acBook = csv('Account owner,Link\nSarah Olney MP,https://bsky.app/profile/sarah.bsky.social\nLondon Lib Dems,https://www.instagram.com/londonlibdems/\nHina Bokhari AM,https://example.org/hina\n,');
const ac = readWithAll(acBook.sheets[0], LOOKUPS);
ok(ac[0].importer.id === 'accounts' && ac[0].result.entries[0].entry.platform === 'BlueSky' && ac[0].result.entries[0].entry.handle === 'sarah.bsky.social' && ac[0].result.entries[1].entry.platform === 'Instagram' && ac[0].result.entries[2].fatal, 'a sheet of owners and links is recognised as tracked accounts; a link to an unknown site is refused with the reason');

console.log(failed ? `\n${failed} check(s) failed` : '\nAll spreadsheet import checks passed.');
process.exit(failed ? 1 : 0);
