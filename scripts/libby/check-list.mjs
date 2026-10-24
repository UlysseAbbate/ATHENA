#!/usr/bin/env node
// Checks the reader of the Government Whips' Office "Today's Lists" PDF and the estimated start times, on the text of two real lists
// (scripts/fixtures: Tuesday 20 October 2026 and Thursday 22 October 2026, as read from the PDF by pdf.js).
//   node scripts/check-list.mjs
// If a list the reader cannot cope with turns up, add its text here as a new fixture (see how the existing ones were made: one
// { text, para } per line) and fix the reader (public/js/docs/list-parser.js) until this passes.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseTodaysList, clockToMinutes, minutesToClock, durationToMinutes, expandName } from '../../site/libby/js/docs/list-parser.js';
import * as T from '../../site/libby/js/docs/sitting-times.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const read = (name) => parseTodaysList(JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')));
const withKeys = (list) => { for (const s of list.sections) { const seen = new Map(); for (const it of s.items) it.key = T.itemKey(s.name, it, seen); } return list; };
const times = (list, settings = {}, rules = T.mergeRules()) => list.sections.map((s) => T.estimateSection(s, { settings, rules, weekday: list.weekday }));
const at = (mins) => T.estimateText(mins);
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

/* ---- small helpers */
eq([clockToMinutes('2.30pm'), clockToMinutes('11am'), clockToMinutes('12.15pm'), clockToMinutes('12am')], [870, 660, 735, 0]);
eq([minutesToClock(870), minutesToClock(660), minutesToClock(735)], ['2.30pm', '11am', '12.15pm']);
eq([durationToMinutes('2½ hours'), durationToMinutes('1 hour'), durationToMinutes('40 minutes'), durationToMinutes('x')], [150, 60, 40, null]);
eq([expandName('L Clement-Jones'), expandName('B Lloyd of Effra'), expandName('Bp Peterborough'), expandName('E Effingham'), expandName('V Stansgate'), expandName('D Wellington')],
  ['Lord Clement-Jones', 'Baroness Lloyd of Effra', 'Bishop of Peterborough', 'Earl of Effingham', 'Viscount Stansgate', 'Duke of Wellington']);

/* ---- Tuesday 20 October 2026 */
const tue = withKeys(read('todays-list-2026-10-20.json'));
eq([tue.date, tue.weekday, tue.sections.map((s) => s.name)], ['2026-10-20', 'tuesday', ['Chamber', 'Grand Committee']]);
const [tc, tg] = tue.sections;
eq([tc.start, tc.startMinutes, tg.start, tg.place, tg.risingMinutes], ['2.30pm', 870, '3.45pm', 'Moses Room', 1140]);
eq(tc.items.map((i) => i.kind), ['prayers', 'oq', 'oq', 'oq', 'oq', 'pnq', 'legislation', 'legislation', 'statement', 'legislation']);
eq(tc.items[1].peers, ['Lord Wills']); eq([tc.items[1].minister, tc.items[1].dept, tc.items[1].group.minutes], ['Baroness Winterton of Doncaster', 'FCDO', 40]);
eq([tc.items[5].peers, tc.items[5].minister, tc.items[5].dept, tc.items[5].group.minutes], [['Lord Polak'], 'Baroness Twycross', 'CO', 15], 'the PNQ, whose minister follows the full stop');
eq([tc.items[6].title, tc.items[6].detail, tc.items[6].peers], ['Cyber Security and Resilience (Network and Information Systems) Bill', 'Order of Consideration motion', ['Baroness Lloyd of Effra']]);
eq([tc.items[8].title, tc.items[8].minister, tc.items[8].dept], ['National Care Service', 'Baroness Merron', 'DHSC']);
const afb = tc.items[9]; eq([afb.title, afb.detail, afb.peers], ['Armed Forces Bill', 'Report', ['Baroness Antrobus']]);
eq(afb.groupings.length, 8, 'eight groups, one of them wrapped over two lines'); eq(afb.groupings[5].slice(-3), ['g40', 'g41', 'g42', '43'].slice(-3)); ok(afb.groupings[5].includes('39A'), 'the wrapped row carries on');
eq(afb.guidance.length, 6); ok(afb.notes.some((n) => /complete Report stage/.test(n)));
ok(/Armed Forces Bill/.test(tc.rising) && tc.risingMinutes === null, 'the House rises when Report stage ends: no clock time');
const gm = tg.items[0]; eq([gm.kind, gm.peers, gm.noLimit, gm.backbenchMinutes, gm.speakers.length], ['motion', ['Lord Barrow'], true, 15, 15]);
eq([gm.speakers[0].full, gm.speakers[8].name, gm.speakers[8].full], ['Lord Barrow', 'D Wellington', 'Duke of Wellington']);

/* ---- Thursday 22 October 2026 */
const thu = withKeys(read('todays-list-2026-10-22.json'));
eq([thu.date, thu.weekday], ['2026-10-22', 'thursday']);
const [hc, hg] = thu.sections;
eq([hc.start, hc.rising, hc.risingMinutes, hg.start, hg.rising, hg.risingMinutes], ['11am', 'at around 7pm', 1140, '12.15pm', 'by 3pm', 900]);
eq(hc.items.map((i) => i.kind), ['prayers', 'introduction', 'oq', 'oq', 'oq', 'oq', 'pnq', 'statement', 'motion', 'qsd', 'motion']);
eq(hc.items[1].peers, ['Lord Petterson', 'Baroness Garnham']);
eq([hc.items[2].peers, hc.items[2].askedOf, hc.items[2].minister, hc.items[2].dept], [['Lord Nagaraju'], 'the Senior Deputy Speaker', 'Lord Ponsonby of Shulbrede', 'SDS'], 'a question to the Senior Deputy Speaker');
const [patel, deech, anderson] = hc.items.slice(8);
eq([patel.minutes, patel.timeLimited, patel.speakers.length, patel.speechLimits.default, patel.speechLimits.byName['Lord Clement-Jones'], patel.speechLimits.byName['Earl of Effingham']], [150, true, 24, 4, 10, 10]);
eq([deech.kind, deech.minutes, deech.speakers.length, deech.speechLimits.byName['Baroness Merron']], ['qsd', 60, 10, 10]);
eq([anderson.minutes, anderson.speakers.length, anderson.speechLimits.default], [150, 20, 6]);
eq(patel.speakers.map((s) => s.n).slice(-2), [23, 24]); eq(patel.speakers[4].full, 'Bishop of Peterborough');
eq([hg.items[0].peers, hg.items[0].noLimit, hg.items[0].speakers.length], [['The Senior Deputy Speaker'], true, 17]);

/* ---- estimated start times (Companion 3.1, 6.24, 6.38, 6.7) */
const [e1, e2] = times(thu);
eq(e1.items.map((e) => at(e.start)), ['11am', '11.05am', '11.10am', '11.20am', '11.30am', '11.40am', '11.50am', '12.05pm', '12.45pm', '3.15pm', '4.15pm']);
eq([at(e1.end), at(e2.start), at(e2.end), e2.items[0].how], ['6.45pm', '12.15pm', '3pm', 'rising']);
eq(times(tue)[0].items.map((e) => at(e.start)), ['2.30pm', '2.35pm', '2.45pm', '2.55pm', '3.05pm', '3.15pm', '3.30pm', '3.35pm', '3.40pm', '4.20pm']);
eq(times(tue)[0].items[9].how, 'usualrising', 'the Report stage runs to the usual 10pm: the list gives no clock time');
eq(times(tue)[1].items[0].how, 'rising');

/* ---- changes by hand */
const k = tue.sections[0].items[8].key;
let a = times(tue, { items: { [k]: { start: '16:00' } } })[0].items;
eq([at(a[8].start), at(a[9].start), at(a[7].start)], ['4pm', '4.40pm', '3.35pm'], 'later items move, earlier ones do not');
a = times(tue, { items: { [tue.sections[0].items[6].key]: { minutes: 20 } } })[0].items; eq(at(a[7].start), '3.50pm');
a = times(tue, { sections: { Chamber: { start: '15:00' } } })[0].items; eq(at(a[0].start), '3pm');
a = times(tue, {}, T.mergeRules({ brief: 10, oq: 99, nonsense: 5, pnq: -3, legislation: 'x' }))[0].items; eq([at(a[7].start), at(a[8].start)], ['3.40pm', '3.50pm'], 'rules can be changed; nonsense is ignored');

/* ---- a debate with a speakers' list but no limit adds up the speakers (Companion 4.42) */
eq(T.speakersMinutes({ speakers: Array.from({ length: 5 }, (_, i) => ({ full: `Lord ${i}` })) }), 20 + 15 * 3 + 20);
eq(T.speakersMinutes({ speakers: [{ full: 'A' }, { full: 'B' }, { full: 'C' }], speechLimits: { default: 4, byName: { A: 15 } } }), 15 + 4 + 4);

console.log(`Today's List reader: ${checks} checks passed.`);
