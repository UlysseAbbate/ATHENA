// Checks the readers of legislation.gov.uk data used for the secondary-legislation tracker (lib/libby/legislation-gov.js), on responses recorded from the live site
// (scripts/libby/fixtures/legislation-gov-*.xml). Run: node scripts/libby/check-legislation.mjs
import fs from 'node:fs';
import { parseActSearch, parseContents, parseCommencement, powersUsed, preambleOf, sectionNumbers, sectionKey, buildTracker, actWords } from '../../lib/libby/legislation-gov.js';

const read = (f) => fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');
let failed = 0;
const ok = (cond, name) => { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}`); if (!cond) failed++; };

ok(actWords('Health and Care Act 2022') === 'Health and Care' && actWords('Sovereign Grant Act') === 'Sovereign Grant', 'the words searched for leave out "Act" and the year');
const act = parseActSearch(read('legislation-gov-act-search.xml'), 'Health and Care Act');
ok(act && act.type === 'ukpga' && act.year === 2022 && act.number === 31 && act.title === 'Health and Care Act 2022', 'the Act a Bill became is found by its title (not the similar Levy (Repeal) Act)');
ok(parseActSearch(read('legislation-gov-act-search.xml'), 'Nonexistent Act') === null, 'and an Act that is not there is null');

const contents = parseContents(read('legislation-gov-contents-2022-31.xml'));
ok(contents.length === 5 && contents[0].label === '1' && contents[0].heading === 'NHS Commissioning Board renamed NHS England' && /^PART 1/.test(contents[0].part), 'the contents give each section with its Part');

const effects = parseCommencement(read('legislation-gov-effects-2022-31.xml'));
ok(effects.length === 3 && effects.every((e) => e.si.uri.includes('/uksi/') && e.si.title) && effects.some((e) => e.date), 'the commencement effects are read (only those that bring a provision into force, from instruments)');
ok(effects[0].provision && effects[0].si.year >= 2022, 'with the provision and the instrument');

const pre = preambleOf(read('legislation-gov-si-2023-368-preamble.xml'));
ok(JSON.stringify(powersUsed(pre, 'Health and Care Act 2022')) === JSON.stringify(['103', '105', '183']), 'the powers an instrument uses are read from its preamble: sections 103(1), (2) and (4), 105 and 183(1) and (2)');
ok(powersUsed(pre, 'Some Other Act 2020').length === 0, 'and an instrument made under another Act gives none');
ok(JSON.stringify(sectionNumbers('103(1), (2) and (4), 105 and 183(1) and (2)')) === JSON.stringify(['103', '105', '183']) && JSON.stringify(sectionNumbers('26A and 27')) === JSON.stringify(['26A', '27']), 'section lists keep section numbers, not subsections');
ok(sectionKey('s. 126(3)(i)') === '126' && sectionKey('Sch. 1 para. 14') === '', 'a section is found from its label; a schedule is not a section');

const t = buildTracker(act, contents, effects, [{ title: 'Regs 2023', uri: 'u', year: 2023, number: 1, powers: ['2', '999'] }]);
const s2 = t.sections.find((s) => s.key === '2');
ok(t.sections.length === 5 && s2.powers.length === 1 && t.summary.powerSections === 1 && t.summary.instruments === 1, 'the tracker puts each instrument against the sections whose powers it used (a section not in the Act is ignored)');
ok(t.sections.every((s) => Array.isArray(s.commencement)) && t.summary.commenced === t.sections.filter((s) => s.commencement.length).length, 'and counts the sections brought into force');

// The statutory instruments API (v2). Its list was returning nothing when this was written, so these responses are shaped from its published schema (swagger/v2),
// not recorded: if a real response differs, record it here and fix siSummary / statutoryInstrumentDetail in lib/libby/parliament.js.
import { siSummary, statutoryInstrumentDetail } from '../../lib/libby/parliament.js';
const rawSI = { id: 'a1b2c3d4-0000-0000-0000-000000000001', name: 'The Example (Amendment) Regulations 2026', paperPrefix: 'S.I.', paperNumber: 1178, paperYear: '2026', procedure: { id: 'p1', name: 'Made affirmative' },
  paperMadeDate: '2026-11-03T00:00:00', commonsLayingDate: '2026-11-05T00:00:00', lordsLayingDate: '2026-11-06T00:00:00', workpackageId: 'w1' };
const sm = siSummary(rawSI);
ok(sm.name === rawSI.name && sm.paper === 'S.I. 2026 No. 1178' && sm.laid === '2026-11-06' && sm.laidCommons === '2026-11-05' && sm.made === '2026-11-03' && sm.procedure === 'Made affirmative' && sm.url.endsWith('/instrument/a1b2c3d4-0000-0000-0000-000000000001/timeline/'), 'an instrument from the SI API list is mapped (name, paper, dates, procedure, link)');
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const body = String(url).endsWith('/BusinessItems')
    ? [{ id: 'b1', statutoryInstrumentId: rawSI.id, itemDate: '2026-11-10T00:00:00', link: 'https://example.invalid/x', sequence: 2, houses: ['Lords'], steps: ['Considered by the Secondary Legislation Scrutiny Committee'] },
      { id: 'b0', statutoryInstrumentId: rawSI.id, itemDate: '2026-11-06T00:00:00', link: '', sequence: 1, houses: ['Lords'], steps: ['Laid'] }]
    : { ...rawSI, paperComingIntoForceDate: '2026-12-01T00:00:00', paperComingIntoForceNote: 'subject to approval', layingBody: { departmentId: 7, id: 'd', name: 'Home Office' },
      enablingActs: [{ id: 'x', name: 'Health and Care Act 2022', link: 'https://www.legislation.gov.uk/ukpga/2022/31', number: 31, year: 2022, royalAssent: '2022-04-28' }],
      timelines: [{ id: 't2', dateTime: '2026-11-12T00:00:00', name: 'Debated' }, { id: 't1', dateTime: '2026-11-06T00:00:00', name: 'Laid in the Lords' }] };
  return new Response(JSON.stringify(body), { status: 200 });
};
const det = await statutoryInstrumentDetail(rawSI.id);
globalThis.fetch = realFetch;
ok(det.layingBody === 'Home Office' && det.comingIntoForce === '2026-12-01' && det.enablingActs[0].name === 'Health and Care Act 2022', 'an instrument in full: laying body, coming into force and the Act it is made under');
ok(det.timelines.map((t) => t.name).join('|') === 'Laid in the Lords|Debated' && det.steps.map((x) => x.steps[0]).join('|') === 'Laid|Considered by the Secondary Legislation Scrutiny Committee', 'with its timelines and business-item steps in date order');

console.log(failed ? `\n${failed} check(s) failed` : '\nAll legislation.gov.uk checks passed.');
process.exit(failed ? 1 : 0);
