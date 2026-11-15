// Checks the economic data profile logic (site/lucien/econ-profile.js) and the question reader. Run: node scripts/lucien/check-econ.mjs
import fs from 'node:fs';
const ctx = {};
new Function('globalThis', fs.readFileSync(new URL('../../site/lucien/econ-profile.js', import.meta.url), 'utf8'))(ctx);
const { closest, atomic, bandsOf, jaccard, indicators, profile, parseQuestion } = ctx.EconProfile;
let failed = 0;
const ok = (cond, name) => { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}`); if (!cond) failed++; };

// age bands, as Nomis gives them: five-year bands plus wider ones that contain them
const B = (f, t) => ({ from: f, to: t, label: t >= 100 ? `${f}+` : `${f}-${t}` });
const aps = [B(16, 19), B(20, 24), B(16, 24), B(25, 29), B(30, 34), B(25, 49), B(35, 39), B(40, 44), B(45, 49), B(50, 64), B(16, 64), B(65, 100)];
ok(atomic(aps).map((b) => b.label).join(' ') === '16-19 20-24 25-29 30-34 35-39 40-44 45-49 50-64 65+', 'the finest age bands are the ones that contain no other band');
const m1825 = closest(aps, 18, 25);
ok(m1825.label === '16-24' && !m1825.exact && m1825.score > 0.69, '18-25 is matched to 16-24 (the closest band), not exact');
ok(closest(aps, 18, 30).label === '16-34' || closest(aps, 18, 30).label === '16-29', '18-30 is matched to a run of bands (16-29 or 16-34)');
const m = closest(aps, 25, 29);
ok(m.label === '25-29' && m.exact && m.score === 1, 'an exact band is matched exactly');
ok(closest(aps, 70, 90).label === '65+', 'an open-ended band takes the oldest ages');
ok(closest([], 18, 25) === null, 'no bands, no match');
ok(Math.abs(jaccard(18, 25, 16, 24) - 7 / 10) < 1e-9, 'the overlap score is shared ages over all ages in either range');

// a small table: London and the UK
const row = (geo, name, ds, sex, a, cat, value, extra = {}) => ({ dataset: ds, geography_code: geo, geography_name: name, geography_level: 'region', sex, age_from: a ? a[0] : null, age_to: a ? a[1] : null, age_label: a ? (a[1] >= 100 ? `${a[0]}+` : `${a[0]}-${a[1]}`) : null, category: cat, measure: extra.measure || 'Count', unit: extra.unit || 'people', value, period: extra.period || 'Jul 2025-Jun 2026' });
const rows = [];
for (const [geo, name, k] of [['E12000007', 'London', 1], ['K02000001', 'United Kingdom', 10]]) {
  for (const [a, pop, act, emp, self, un, inact, ft, pt] of [[[16, 24], 100, 70, 60, 5, 10, 30, 35, 25], [[25, 49], 400, 360, 340, 50, 20, 40, 300, 40], [[16, 64], 700, 560, 530, 90, 30, 140, 430, 100]]) {
    const v = (x) => x * k * 100;
    for (const [cat, x] of [['All persons', pop], ['Economically Active', act], ['Employed', emp], ['Self Employed', self], ['Unemployed', un], ['Economically inactive', inact], ['Total Full-time', ft], ['Total Part-time', pt]]) rows.push(row(geo, name, 'aps_labour', 'all', a, cat, v(x)));
  }
  rows.push(row(geo, name, 'ashe', 'male', null, 'All workers', 700 + k, { measure: 'Median weekly pay - gross', unit: '£', period: '2025' }));
  rows.push(row(geo, name, 'ashe', 'female', null, 'All workers', 600 + k, { measure: 'Median weekly pay - gross', unit: '£', period: '2025' }));
  rows.push(row(geo, name, 'gdhi', 'all', null, 'GDHI', 25000 + k * 1000, { measure: 'GDHI per head (£)', unit: '£', period: '2024' }));
  rows.push(row(geo, name, 'claimants', 'all', [16, 24], 'Claimants', 5 + k / 10, { measure: 'Claimants as a proportion of residents aged 16-64', unit: '%', period: 'September 2026' }));
}
const prof = profile(rows, { geo: 'E12000007', sex: 'all', from: 18, to: 25 }, { geo: 'K02000001', sex: 'all', from: 16, to: 64 });
const L = Object.fromEntries(prof.lines.map((l) => [l.key, l]));
ok(Math.abs(L.employment_rate.value - 60) < 1e-9 && L.employment_rate.band === '16-24', 'employment rate = employed / all people in the closest band (60% of 16-24s)');
ok(Math.abs(L.unemployment_rate.value - (10 / 70 * 100)) < 1e-9, 'unemployment rate is of those economically active');
ok(Math.abs(L.employment_rate.compare - (530 / 700 * 100)) < 1e-9 && L.employment_rate.compareBand === '16-64' && Math.abs(L.employment_rate.diff - (60 - 530 / 7)) < 1e-9, 'the comparison is the UK working-age average, and the difference is in percentage points');
ok(Math.abs(L.part_time.value - (25 / 60 * 100)) < 1e-9, 'part-time share is of full-time plus part-time');
ok(L.claimant_rate && Math.abs(L.claimant_rate.value - 5.1) < 1e-9, 'claimant rate comes from the closest single band');
ok(L['ashe_Median weekly pay - gross_female'] && L['ashe_Median weekly pay - gross_male'] && /not available by age/.test(L['ashe_Median weekly pay - gross_male'].note), 'pay is shown for both sexes when none is chosen, and says it has no age breakdown');
ok(L.gdhi_per_head.value === 26000 && L.gdhi_per_head.compare === 35000, 'household income per head is the area and the comparison');
ok(profile(rows, { geo: 'E12000007', sex: 'female', from: 18, to: 25 }, { geo: 'K02000001', sex: 'female', from: 16, to: 64 }).lines.every((l) => l.dataset === 'ashe' || l.dataset === 'gdhi' || l.dataset === 'claimants' ? true : false), 'a sex with no survey rows gives no survey indicators (and nothing breaks)');
ok(indicators([], 'X', 'all', 18, 25).indicators.length === 0, 'no data, no indicators');

// the question reader
const q1 = parseQuestion('create a data profile, compared to the average, of Londoners aged 18-25');
ok(q1.area === 'London' && q1.from === 18 && q1.to === 25 && q1.sex === 'all', 'Londoners aged 18-25 -> London, 18-25, everyone');
const q2 = parseQuestion('women in the North West over 50 compared to the UK');
ok(q2.area === 'North West' && q2.from === 50 && q2.to === 100 && q2.sex === 'female', 'women in the North West over 50 -> North West, 50+, women (the UK after "compared" is not the area)');
const q3 = parseQuestion('young people in Scotland');
ok(q3.area === 'Scotland' && q3.from === 18 && q3.to === 24, 'young people -> 18-24');
const q4 = parseQuestion('men under 30 in Wales');
ok(q4.area === 'Wales' && q4.from === 16 && q4.to === 29 && q4.sex === 'male', 'men under 30 -> 16-29');
const q5 = parseQuestion('');
ok(q5.area === 'United Kingdom' && q5.from === 16 && q5.to === 64 && q5.sex === 'all', 'nothing said -> the UK, working age, everyone');
ok(parseQuestion('pensioners in Yorkshire').area === 'Yorkshire and The Humber' && parseQuestion('pensioners in Yorkshire').from === 65, 'pensioners in Yorkshire -> Yorkshire and The Humber, 65+');

console.log(failed ? `\n${failed} check(s) failed` : '\nAll economic profile checks passed.');
process.exit(failed ? 1 : 0);
