// Checks the "Give me an Update" Word document (site/libby/js/docs/update-doc.js) on a sample Bill: the title, the four sections, the amendment and division links.
// Run: node scripts/libby/check-update-doc.mjs
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { buildUpdateDoc, updateTitle } from '../../site/libby/js/docs/update-doc.js';
import { divisionResult, nextSitting, amendmentPlace, takesAmendments } from '../../lib/libby/bill-update.js';

let failed = 0;
const ok = (cond, name) => { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}`); if (!cond) failed++; };
const load = (f, global) => new Function(`${fs.readFileSync(new URL(`../../site/libby/vendor/${f}`, import.meta.url), 'utf8')}\n;return ${global};`)();
const D = load('docx.iife.js', 'docx');
const JSZip = createRequire(import.meta.url)('../../site/libby/vendor/jszip.min.js');

const data = {
  generated: '2026-11-10',
  bill: { id: 4124, title: 'Health Bill [HL]', longTitle: 'A Bill to make provision about health.', originatingHouse: 'Commons', isAct: false, currentStage: 'Committee stage', currentHouse: 'Lords', url: 'https://bills.parliament.uk/bills/4124' },
  team: { commons: { adviser: 'Chris Commons', lead: 'Daisy Cooper' }, lords: { adviser: 'Pat Adviser', lead: 'Lord Alpha' } },
  next: { date: '2026-11-11', stage: 'Committee stage', house: 'Lords' },
  summary: { official: '', parts: [{ part: 'PART 1: Health service', first: '1', last: '12', count: 12, headings: ['NHS England renamed'] }], sources: [{ label: 'Explanatory Notes', url: 'https://bills.parliament.uk/publications/1' }] },
  ldActivity: { internal: true, stages: [{ house: 'Lords', stage: 'Committee stage', totalTabled: 40, amendments: [
    { id: 1, number: '12', place: 'Clause 3, page 2, line 14', summary: 'Leave out subsection (2)', lead: 'Lord Alpha', url: 'https://bills.parliament.uk/bills/4124/stages/1/amendments/1', flags: ['voting', 'content', 'win'], notes: ['Key amendment for the Leader'], concession: true, concessionNotes: 'Government will bring forward its own wording', noteworthy: true },
    { id: 2, number: '13', place: 'Clause 4', summary: 'Insert a review', lead: 'Baroness Beta', url: 'https://bills.parliament.uk/bills/4124/stages/1/amendments/2', flags: [], notes: [], concession: false, concessionNotes: '', noteworthy: false }] }] },
  divisions: [{ house: 'Commons', date: '2026-09-07', title: 'Health Bill: Report Stage: New Clause 6', content: 77, notContent: 317, ldContent: 56, ldNotContent: 0, url: 'https://votes.parliament.uk/votes/commons/division/2418', result: 'Disagreed (Noes won)' }],
};
ok(updateTitle(data) === 'Health Bill Update 10 November 2026', 'the document is titled "[Bill] Update [Date]" (without [HL])');
const ai = { overview: 'The Bill reorganises the NHS.', parts: [{ heading: 'Part 1: Health service', summary: 'Renames and restructures NHS England.' }] };
const buf = await D.Packer.toBuffer(buildUpdateDoc(D, data, ai));
const xml = await (await JSZip.loadAsync(buf)).file('word/document.xml').async('string');
const rels = await (await JSZip.loadAsync(buf)).file('word/_rels/document.xml.rels').async('string');
const text = xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
ok(['1. Intro', '2. Summary', '3. Lib Dem activity', '4. Parliamentary activity'].every((h) => text.includes(h)), 'it has the four sections');
ok(/Current stage:\s*Committee stage \(Lords\)/.test(text) && /Next sitting:/.test(text) && /Adviser Chris Commons; Bill lead Daisy Cooper/.test(text) && /Adviser Pat Adviser; Bill lead Lord Alpha/.test(text), 'the intro gives the stage, the next sitting, and the advisers and Bill leads in both Houses');
ok(text.includes('The Bill reorganises the NHS.') && text.includes('Part 1: Health service') && text.includes('Renames and restructures NHS England.'), 'the summary and the Parts are there');
ok(/Amendment 12/.test(text) && /WIN, Voting, Content/.test(text) && /Key amendment for the Leader/.test(text) && /Government will bring forward its own wording/.test(text), 'a marked amendment gets its flags, notes and concession');
ok(/Am 13/.test(text) && /Insert a review/.test(text), 'an ordinary amendment gets one line');
ok(/56 Aye, 0 No/.test(text) && /Disagreed \(Noes won\): 77 to 317/.test(text), 'the votes show how the Lib Dems voted and the result');
ok(rels.includes('bills.parliament.uk/bills/4124/stages/1/amendments/1') && rels.includes('votes.parliament.uk/votes/commons/division/2418'), 'amendments and divisions are links');
const plain = await D.Packer.toBuffer(buildUpdateDoc(D, { ...data, summary: { ...data.summary, official: 'The official summary.' }, ldActivity: { internal: false, stages: [] }, divisions: [] }, null));
const t2 = (await (await JSZip.loadAsync(plain)).file('word/document.xml').async('string')).replace(/<[^>]+>/g, ' ');
ok(/The official summary\./.test(t2) && /No amendments have been tabled/.test(t2) && /no votes on this Bill yet/.test(t2) && /Parts of the Act/.test(t2), 'without the written summary it uses the official wording, and says when there is nothing to report');

ok(divisionResult({ house: 'Lords', content: 100, notContent: 50 }) === 'Agreed (Contents won)' && divisionResult({ house: 'Commons', content: 10, notContent: 50 }) === 'Disagreed (Noes won)', 'a division result is worked out for each House');
ok(nextSitting([{ description: 'A', house: 'Lords', dates: ['2026-11-09', '2026-11-12'] }, { description: 'B', house: 'Commons', dates: ['2026-11-11'] }], '2026-11-10').stage === 'B', 'the next sitting is the earliest on or after today');
ok(amendmentPlace({ clause: 3, page: 2, line: 14, type: 'Leave out' }) === 'Clause 3, page 2, line 14' && /New Clause/.test(amendmentPlace({ type: 'Add clause', clause: 4 })), 'an amendment’s place is put into words');
ok(takesAmendments({ description: 'Committee stage' }) && !takesAmendments({ description: '2nd reading' }), 'only the stages that take amendments are read');

console.log(failed ? `\n${failed} check(s) failed` : '\nAll update-document checks passed.');
process.exit(failed ? 1 : 0);
