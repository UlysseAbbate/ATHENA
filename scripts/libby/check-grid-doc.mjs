// Checks the Whips' Office Word documents (site/libby/js/docs/word.js, grid-data.js) against the "DOCUMENTS" guidance: the Committee/Report Stage Grid
// (A4 landscape, five columns, one group per page, Place in Bill, LD speakers, shading, Arial throughout) and the Report Stage Hymn Sheet, and their file names.
// Run: node scripts/libby/check-grid-doc.mjs
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { buildGridDoc, buildHymnDoc, billCode, docFileName } from '../../site/libby/js/docs/word.js';
import { placeLines } from '../../site/libby/js/docs/grid-data.js';

let failed = 0;
const ok = (cond, name) => { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}`); if (!cond) failed++; };
const load = (f, global) => new Function(`${fs.readFileSync(new URL(`../../site/libby/vendor/${f}`, import.meta.url), 'utf8')}\n;return ${global};`)();
const D = load('docx.iife.js', 'docx');
const JSZip = createRequire(import.meta.url)('../../site/libby/vendor/jszip.min.js');

// file names: "[Bill Code] [Stage Code] [Document Title]"
ok(billCode('Financial Services and Markets Bill') === 'FSMB' && billCode('Cyber Security and Resilience Bill') === 'CSRB' && billCode('Health Bill [HL]') === 'HB', 'the Bill Code is the first letter of each major word (minor words left out)');
ok(docFileName({ billTitle: 'Financial Services and Markets Bill', stage: 'Committee', title: 'Grid' }) === 'FSMB L_CS Grid.docx'
  && docFileName({ billTitle: 'Financial Services and Markets Bill', stage: 'Report', title: 'Hymn Sheet' }) === 'FSMB L_RS Hymn Sheet.docx'
  && docFileName({ billTitle: 'Financial Services and Markets Bill', house: 'Commons', stage: 'Report', title: 'Grid' }) === 'FSMB C_RS Grid.docx', 'files are named like "FSMB L_CS Grid.docx"');

// Place in Bill
ok(JSON.stringify(placeLines({ clause: 1, page: 1, line: 6, place: 'Clause 1, page 1, line 6', type: 'EditText' })) === '["Clause 1","Page 1, line 6"]', 'an amendment to a clause: the clause, then the page and line');
ok(JSON.stringify(placeLines({ schedule: 1, page: 134, line: 36, place: 'Schedule 1, page 134, line 36' })) === '["Schedule 1","Page 134, line 36"]', 'an amendment to a Schedule');
ok(JSON.stringify(placeLines({ clause: 1, place: 'New Clause (after Clause 1)', type: 'AddNew' })) === '["After Clause 1"]', 'a new clause: "After Clause 1", with no page or line');
ok(JSON.stringify(placeLines({ clause: 2, place: 'Clause 2 stand part / leave out', type: 'Delete' })) === '["Clause 2 stand part"]', 'a stand part notice: "Clause 2 stand part"');
ok(JSON.stringify(placeLines({ place: '' })) === '["[location unclear]"]' && JSON.stringify(placeLines(null)) === '["[location unclear]"]', 'a location that cannot be read says so, never invented');

// the grid
const grid = { billTitle: 'Financial Services and Markets Bill', stageWord: 'Committee', day: 2, groups: [
  { number: '1', topic: 'Votes at 16', ldSpeakers: ['Baroness Bakewell', 'Lord Alpha'], rows: [
    { num: '1', place: ['Clause 1', 'Page 1, line 6'], peers: [{ name: 'Baroness Bakewell', ld: true }, { name: 'Lord Gamma', ld: false }], text: 'This amendment would lower the voting age.', briefings: [] },
    { num: '2', place: ['After Clause 1'], peers: [{ name: 'Lord Alpha', ld: true }], text: 'A new clause.', briefings: ["Women's Aid"] },
    { num: '3', place: ['Clause 2 stand part'], peers: [{ name: 'Lord Gamma', ld: false }], text: '', briefings: [] }] },
  { number: '2', topic: 'Online harms', ldSpeakers: [], rows: [{ num: 'C4', place: ['Clause 4'], peers: [{ name: 'Lord Delta', ld: false }], text: 'Text.', briefings: [] }] },
  { number: '3', topic: 'Other', ldSpeakers: [], rows: [{ num: '9', place: ['[location unclear]'], peers: [], text: 'Text.', briefings: [] }] }] };
const xml = async (doc, part = 'word/document.xml') => (await JSZip.loadAsync(await D.Packer.toBuffer(doc))).file(part).async('string');
const gx = await xml(buildGridDoc(D, grid));
const text = gx.replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, ' ').replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ');
ok(/<w:pgSz[^>]*w:orient="landscape"/.test(gx) && /<w:pgSz[^>]*w:w="16838"[^>]*w:h="11906"|<w:pgSz[^>]*w:h="11906"[^>]*w:w="16838"/.test(gx), 'the grid is A4 landscape');
ok(/w:left="720"/.test(gx) && /w:right="720"/.test(gx) && /w:top="720"/.test(gx) && /w:bottom="720"/.test(gx), 'with narrow (1.27 cm) margins');
ok([737, 1814, 2608, 7541, 2665].every((w) => gx.includes(`<w:gridCol w:w="${w}"`)), 'the five columns are 1.3, 3.2, 4.6, 13.3 and 4.7 cm wide');
ok(['Am#', 'Place in Bill', 'Peer(s)', "Member's Explanatory Statement", 'Briefings'].every((h) => text.includes(h)) && !/Notes/.test(text), 'the columns are Am#, Place in Bill, Peer(s), Member’s Explanatory Statement and Briefings');
ok(/Financial Services and Markets Bill/.test(text) && /Committee Stage Grid — Day 2/.test(text), 'the title is the Bill’s name and the subtitle carries the stage and day');
ok(/Group 1 – Votes at 16/.test(text) && /LD Speakers: Baroness Bakewell, Lord Alpha/.test(text) && /LD Speakers:\s*\n/.test(text), 'each group has its name and an LD Speakers line (blank when no Liberal Democrat peer sponsors)');
ok((gx.match(/w:pageBreakBefore/g) || []).length === 2 && (gx.match(/<w:tbl>/g) || []).length === 3, 'one table per group, and a page break before every group except the first');
ok(!/w:tblHeader/.test(gx), 'a table running onto a new page does not repeat its heading rows');
ok(/BAKEWELL/.test(text) && /BARONESS BAKEWELL/.test(text) && /LORD GAMMA/.test(text), 'peers are in capitals');
ok((gx.match(/w:highlight w:val="yellow"/g) || []).length === 2, 'Liberal Democrat peers are highlighted yellow (and nobody else)');
const fills = [...gx.matchAll(/<w:shd [^>]*w:fill="([0-9A-F]{6})"/g)].map((m) => m[1]);
ok(fills.filter((f) => f === '1F3864').length === 3 + 3 * 5, 'the group heading row and the column header row are navy, in every group');
ok(fills.filter((f) => f === 'FFF2CC').length === 5 && fills.filter((f) => f === 'FFFFFF').length === 2 * 5 + 5 + 5, 'data rows alternate white and light orange-yellow, starting white again in each group');
ok(/w:color="BFBFBF"/.test(gx) && /w:sz="6"/.test(gx), 'borders are thin and light grey');
const fonts = new Set([...gx.matchAll(/w:ascii="([^"]+)"/g)].map((m) => m[1]));
ok(fonts.size === 1 && fonts.has('Arial'), `Arial throughout (${[...fonts].join(', ')})`);
const sizes = new Set([...gx.matchAll(/<w:sz w:val="(\d+)"/g)].map((m) => m[1]));
ok(['24', '18', '16'].every((z) => sizes.has(z)), 'the heading row is 12pt and 9pt, the column labels and Am# 9pt, the rest 8pt');
const hx = await xml(buildGridDoc(D, grid), 'word/header1.xml');
ok(/LORDS LEGISLATION ADVISER, LORDS WHIPS OFFICE/.test(hx) && /ULYSSE ABBATE/.test(hx) && /w:jc w:val="right"/.test(hx), 'the right-aligned two-line header is on every page');

// the hymn sheet
const hymn = await xml(buildHymnDoc(D, { billTitle: 'Financial Services and Markets Bill', day: 2, groups: [{ number: '1', refsLabel: '1, 2, 3', theme: 'This Group relates to votes at 16.' }, { number: '2', refsLabel: '4', theme: 'Online harms.' }] }));
ok(!/w:orient="landscape"/.test(hymn) && /Hymn Sheet: Report Stage Day 2/.test(hymn.replace(/<[^>]+>/g, '')) && /VOTE SUMMARY/.test(hymn) && /\[Division \/ voting instructions — to be completed\]/.test(hymn.replace(/<[^>]+>/g, '')), 'the hymn sheet is portrait, with the vote summary box and a placeholder for each group');

console.log(failed ? `\n${failed} check(s) failed` : '\nAll grid document checks passed.');
process.exit(failed ? 1 : 0);
