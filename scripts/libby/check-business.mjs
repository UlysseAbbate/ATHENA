// Checks how stored Lords business rows become a day's sections: the Order Paper, the committees and the What's On merge.
// Run: node scripts/libby/check-business.mjs
import fs from 'node:fs';
import { sectionsFromFB, sectionsFromWhatsOn, committeesFromWhatsOn, mergeWhatsOn, risingFromWhatsOn, enrichSections, itemCount } from '../../lib/libby/business.js';
import { dbRowToEvent } from '../../lib/libby/parliament.js';

const read = (f) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));
let failed = 0;
const ok = (cond, name) => { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}`); if (!cond) failed++; };

const sections = sectionsFromFB(read('order-paper-rows-2026-10-28.json'));
const chamber = sections.find((s) => s.name === 'Chamber');
const gc = sections.find((s) => s.name === 'Grand Committee');
ok(chamber && gc && chamber.items[0].kind === 'oq', 'the Order Paper gives a Chamber and a Grand Committee, starting with Oral Questions');
ok(chamber.items[0].peers[0] === 'Lord Young of Cookham' && /^what progress has been made/.test(chamber.items[0].title) && chamber.items[0].memberId === 57, 'an Oral Question is split into who asks and what is asked, with the member id');
ok(gc.items.length === 7 && gc.items.every((i) => i.kind === 'si'), 'the Grand Committee has its seven statutory instruments');

// A Liberal Democrat is recognised by Parliament's member id (a list of Lib Dem peers is all that is needed).
await enrichSections(sections, { date: '2026-10-28', bills: [], isLD: ({ id }) => id === 57, findDebate: async () => ({ url: '', exact: false }) });
ok(chamber.items[0].peers[0].ld === true && chamber.items[1].peers[0].ld === false, 'the member id marks a Lib Dem peer');

const events = read('whatson-rows-2026-11-03.json').map((r) => dbRowToEvent({ ...r }));
const committees = committeesFromWhatsOn(events);
ok(committees && committees.name === 'Committees' && committees.items.every((i) => i.kind === 'committee' && i.title), 'committee meetings become a Committees section');
ok(sectionsFromWhatsOn(events).every((s) => s.name !== 'Committees'), 'and are kept out of the chamber sections');

const day = sectionsFromFB([
  { business_date: '2026-11-03', section: 'Chamber', position: 0, text: 'Health Bill Committee [Baroness Merron]', kind: 'legislation', member_id: 347 },
  { business_date: '2026-11-03', section: 'Chamber', position: 1, text: 'Prison (Governor’s and Adjudicators’ Punishments) (Amendment) Rules 2026 Approval [Baroness Hyde of Bemerton]', kind: 'si' },
]);
mergeWhatsOn(day, events);
const [bill, si] = day[0].items;
ok(bill.billId && bill.eventId, 'a Bill on the Order Paper picks up its Bill id and event from the calendar');
ok(si.speakersEventId && si.eventId, 'an item with a speakers list picks up the event to ask for the speakers');
ok(itemCount(day) === 2, 'merging adds no items');

const rising = risingFromWhatsOn([{ category: 'Estimated rising time', start: '22:00', section: 'Chamber' }, { category: 'Debate', start: '15:00', section: 'Chamber' }]);
ok(rising.Chamber === '22:00' && Object.keys(rising).length === 1, 'the estimated rising time is read from the calendar');
ok(!sectionsFromWhatsOn([{ section: 'Chamber', category: 'Estimated rising time', title: 'Estimated rising time', members: [], summary: '' }]).length, 'and is not shown as an item of business');

// The scheduled updates: GitHub starts timed runs hours late, so an update is due if nothing was renewed since the last 6am or 6pm London (not "if it is 6am now")
import { lastSlotStart, updateIsDue } from '../../lib/libby/schedule.js';
const slot = (iso) => lastSlotStart(new Date(iso)).toISOString();
ok(slot('2026-11-09T14:06:00Z') === '2026-11-09T06:00:00.000Z' && slot('2026-11-08T21:15:00Z') === '2026-11-08T18:00:00.000Z' && slot('2026-11-09T05:59:00Z') === '2026-11-08T18:00:00.000Z', 'in winter the slots start at 06:00 and 18:00 UTC');
ok(slot('2026-07-10T14:00:00Z') === '2026-07-10T05:00:00.000Z' && slot('2026-07-10T03:00:00Z') === '2026-07-09T17:00:00.000Z', 'in summer they start at 05:00 and 17:00 UTC (6am and 6pm London)');
ok(updateIsDue('2026-11-08T18:03:00Z', new Date('2026-11-09T14:06:00Z')) && !updateIsDue('2026-11-09T06:40:00Z', new Date('2026-11-09T14:06:00Z')) && updateIsDue(null), 'a run started late is due when nothing was renewed since the slot began, and skips when something was');

// The Commons calendar: the What's On API's own Commons events become the Chamber and Westminster Hall, with Oral Questions and legislation
import { eventsFromApi, liveEvents, WHATSON_CHUNK_DAYS } from '../../lib/libby/lordsbusiness.js';
import { commonsSections } from '../../lib/libby/commons.js';
const commonsApi = read('whatson-commons-api-2026-11-04.json');
const commonsEvents = eventsFromApi(commonsApi, 'Commons');
const commonsDay = commonsSections(commonsEvents.filter((e) => e.date === '2026-11-04' && (e.section === 'Chamber' || e.section === 'Westminster Hall')));
const cItems = commonsDay.sections.flatMap((s) => s.items);
ok(commonsDay.sections.map((s) => s.name).join('|') === 'Chamber|Westminster Hall', 'the Commons day has a Chamber and a Westminster Hall from the What\'s On API');
ok(cItems.some((i) => i.kind === 'oq' && i.title === 'Wales') && cItems.some((i) => i.kind === 'legislation' && /Sporting Events Bill/.test(i.title)), 'with Oral Questions (by department) and legislation (by Bill)');

// The API refuses a range of more than about a month (400), so a long range is asked for a fortnight at a time and put back together
const asked = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const u = new URL(url);
  const from = u.searchParams.get('queryParameters.startDate'), to = u.searchParams.get('queryParameters.endDate');
  asked.push([from, to]);
  const days = (Date.parse(to) - Date.parse(from)) / 864e5;
  if (days > 31) return new Response('{"Message":"An error has occurred."}', { status: 400 });
  return new Response(JSON.stringify(commonsApi.filter((e) => e.StartDate.slice(0, 10) >= from && e.StartDate.slice(0, 10) <= to)), { status: 200 });
};
const long = await liveEvents(null, '2026-11-04', '2026-12-15', 'Commons');
globalThis.fetch = realFetch;
ok(asked.length === 3 && asked.every(([f, t]) => (Date.parse(t) - Date.parse(f)) / 864e5 < WHATSON_CHUNK_DAYS) && asked[0][0] === '2026-11-04' && asked.at(-1)[1] === '2026-12-15', 'a six-week range is asked for in fortnights, covering every day');
ok(long.length === commonsEvents.length && long.every((e, i) => e.title === commonsEvents[i].title), 'and the fortnights are put back together in order');

// Voting Data for the Commons: the same calculations as the Lords, with Aye / No (a tie is settled against the motion by the Speaker's casting vote)
import { analyseDivision, votingData } from '../../lib/libby/voting-analysis.js';
const cdiv = { division_id: 2473, number: 118, division_date: '2026-11-04', title: 'Sporting Events Bill [Lords] Report: New Clause 1', content: 62, not_content: 286,
  parties: { Conservative: { c: 5, nc: 90 }, Labour: { c: 2, nc: 190 }, 'Labour (Co-op)': { c: 0, nc: 30 }, 'Liberal Democrat': { c: 50, nc: 0 } } };
const ca = analyseDivision(cdiv, () => 'DCMS', 'commons');
ok(ca.result === 'No' && ca.parties.lab.intention === 'No' && ca.parties.lab.votes === 220 && ca.parties.ld.intention === 'Aye' && ca.url === 'https://votes.parliament.uk/votes/commons/division/2473', 'a Commons division is worked out with Aye and No, counting Labour (Co-op) as Labour, and links to the Commons vote');
ok(ca.govWin && !ca.ldCon && !ca.ldLab && ca.ldAlone && ca.ldNoSupport && !ca.ldDiff, 'the Government (Labour) won, and the Lib Dems voted alone');
ok(analyseDivision({ ...cdiv, content: 100, not_content: 100 }, () => '', 'commons').result === 'No', 'a tie in the Commons counts as a No');
const cd = votingData([cdiv], { departmentOf: () => 'DCMS', house: 'commons' });
ok(cd.house === 'commons' && cd.sides.join('|') === 'Aye|No' && cd.total.divisions === 1 && cd.total.ldAlone === 1, 'the Commons voting data says which House and which sides');
ok(analyseDivision({ ...cdiv, content: 10, not_content: 5 }, () => '').result === 'Content', 'the Lords calculation is as it was (Content / Not Content)');

console.log(failed ? `\n${failed} check(s) failed` : '\nAll business checks passed.');
process.exit(failed ? 1 : 0);
