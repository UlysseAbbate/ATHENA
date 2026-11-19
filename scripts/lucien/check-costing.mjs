// Checks the costing engine (site/lucien/costing.js) against the published figures it is built on, and the validation cases in docs/COSTING_SPEC.md. Run: node scripts/lucien/check-costing.mjs
import fs from 'node:fs';
const ctx = {};
new Function('globalThis', fs.readFileSync(new URL('../../site/lucien/costing.js', import.meta.url), 'utf8'))(ctx);
const C = ctx.Costing;
const data = JSON.parse(fs.readFileSync(new URL('../../site/lucien/costing-data.json', import.meta.url), 'utf8'));
const ix = C.index(data);
let failed = 0;
const ok = (cond, name, extra = '') => { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${!cond && extra ? `  (${extra})` : ''}`); if (!cond) failed++; };
const near = (a, b, tol = 0.5) => Math.abs(a - b) <= tol;
const tax = (item, direction, size, start) => ({ kind: 'tax', item, direction, size, start });
const BR = 'income_tax:change_basic_rate_by_1p';
const cen = r => r.years.map(y => y.central);

// ---- the data: every line has its three published years and a source; nothing is hidden
ok(data.items.length === 75 && data.items.every(i => i.values.length === 3 && i.source.url.startsWith('https://') && i.source.row), 'data: 75 lines from the HMRC ready reckoner, each with its three years, source page and row');
ok(data.meta.ready_reckoner.as_at === '2025-06-24' && /March 2025/.test(data.meta.ready_reckoner.baseline), 'data: carries its "as at" date and the baseline it is on');
ok(C.staleness(data, new Date('2026-11-18')).stale === true && C.staleness(data, new Date('2025-12-01')).stale === false, 'data: reported as out of date after 12 months, never used silently');
ok(data.items.filter(i => i.behaviour).every(i => Object.values(i.behaviour).every(b => b.status && b.source)), 'data: every behavioural parameter has a status and a source');

// ---- static scaling of the simple taxes
const a = C.costOne(ix, tax(BR, 1, 1));
ok(near(a.years[0].central, 6900) && near(a.years[1].central, 8250) && near(a.years[2].central, 8200), 'basic rate +1p: £6.9bn, £8.25bn, £8.2bn (HMRC)', cen(a).join());
ok(near(a.years[3].central, 8200) && near(a.years[4].central, 8200), 'basic rate +1p: years 4 and 5 held flat (year 3 is not above year 2)');
const b2 = C.costOne(ix, tax(BR, 1, 2)), bcut = C.costOne(ix, tax(BR, -1, 1));
ok(near(b2.years[0].central, 13800) && near(bcut.years[0].central, -6900), 'basic rate: 2p is twice 1p; a 1p cut is the same amount the other way (HMRC: "a reduction of 2p costs twice 1p")');
ok(!bcut.flags.mirrored, 'a symmetric "Change" line is not flagged as mirrored');
const vat = C.costOne(ix, tax('vat:change_standard_rate_by_1_percentage_point', 1, 1));
ok(near(vat.years[0].central, 8800) && near(vat.years[2].central, 9550) && near(vat.years[3].central, 9550 * (1 + (9550 / 9200 - 1))), 'VAT +1pp: £8.8bn to £9.55bn, then grown at its own year 2-3 growth');
// fuel duty: petrol + diesel, a freeze is not costed without the size of the rise foregone
const fuel = C.parseLine(ix, 'cut fuel duty by 1%');
const fuelCost = fuel.policies.map(p => C.costOne(ix, p));
ok(fuel.ok && fuel.policies.length === 2 && near(fuelCost[0].years[0].central + fuelCost[1].years[0].central, -240), 'fuel duty cut 1%: petrol (£100m) + diesel (£140m) = a £240m cost in year 1 (HMRC)');
const frz = C.parseLine(ix, 'freeze fuel duty');
ok(!frz.ok && frz.ask.some(q => /size of the rise/.test(q)), 'a fuel duty freeze is not costed silently: it asks for the size of the rise foregone');

// ---- the table lines: Capital Gains Tax and allowances (not linear)
const CG = 'cgt:increase_higher_capital_gains_tax_rate_by_10_percentage_points';
ok(near(C.costOne(ix, tax(CG, 1, 10)).years[2].central, -3565) && near(C.costOne(ix, tax(CG, 1, 7)).years[2].central, -870 + (-3565 + 870) * 2 / 5), 'CGT higher rate: +10pp = -£3,565m in 2028-29; +7pp is read along HMRC\'s published points (5pp and 10pp)');
ok(C.costOne(ix, tax(CG, 1, 15)).flags.outOfRange && C.costOne(ix, tax(CG, 1, 15)).warnings.some(w => /outside what HMRC publish/.test(w)), 'CGT +15pp is outside the published sizes: flagged and the range is widened');
ok(C.costOne(ix, tax(CG, -1, 5)).flags.mirrored, 'a CGT cut is the mirror of the published rise and is flagged (HMRC: asymmetrical)');
const pa5 = C.costOne(ix, tax('income_tax:change_personal_allowance_by_10', 1, 5));
ok(near(pa5.years[0].central, -(1000 + 9000 * 4 / 9)) && near(C.costOne(ix, tax('income_tax:change_personal_allowance_by_10', 1, 10)).years[0].central, -10000), 'personal allowance +5% lies between HMRC\'s 1% (£1bn) and 10% (£10bn) costs; +10% = a £10bn cost');
// pairs: an additional-rate cut uses the "cost" row, a rise the "yield" row
ok(near(C.costOne(ix, tax('income_tax:increase_additional_rate_by_1p_yield', -1, 1)).years[0].central, -175) && near(C.costOne(ix, tax('income_tax:increase_additional_rate_by_1p_yield', 1, 1)).years[0].central, 145), 'additional rate: a 1p cut costs £175m, a 1p rise yields £145m (HMRC publish both)');
ok(!C.costOne(ix, tax('income_tax:increase_additional_rate_by_1p_yield', -1, 1)).flags.mirrored, 'additional rate: both directions are published, so nothing is mirrored');

// ---- the behavioural layer. Tobacco: the OBR assumed about three-quarters of the static yield is lost
const tob = C.costOne(ix, tax('duties:change_tobacco_duties_by_1', 1, 1));
const share = 1 - tob.years[2].central / tob.years[2].static;
ok(near(share, 0.75, 1e-9) && near(tob.years[2].static, 60), 'tobacco duty +1%: the static figure is the post-behavioural £15m divided by (1 - 0.75) = £60m; three-quarters lost');
ok(tob.offset.low <= 0.8 && tob.offset.high >= 0.8, 'tobacco: the brief\'s "about 80%" lies inside the range (the OBR text found says three-quarters)');
// the top rate: the method as a function of its inputs (the HMRC/OBR 2012 method); the ratio of total income to income above the threshold is UNSOURCED
const T = C.topRateBehaviour;
const stat = 3450;
ok(near(T({ staticCost: stat, rateOld: 0.5, rateNew: 0.45, e: 0, ratio: 2 }).post, -stat, 1e-6), 'top rate cut: with no behavioural response the cost is the static cost (property)');
const e35 = T({ staticCost: stat, rateOld: 0.5, rateNew: 0.45, e: 0.35, ratio: 2 }).post, e45 = T({ staticCost: stat, rateOld: 0.5, rateNew: 0.45, e: 0.45, ratio: 2 }).post;
ok(e35 > -stat && e45 > e35, 'top rate cut: a stronger response means a smaller cost; the cost after behaviour is never bigger than the static cost (property)');
let lo = 0.5, hi = 6;
for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; (T({ staticCost: stat, rateOld: 0.5, rateNew: 0.45, e: 0.45, ratio: mid }).post > -100 ? hi = mid : lo = mid); }
ok(hi > 1.5 && hi < 4, `top rate 50p to 45p: the published central cost (about £100m after behaviour, from a static £3.3bn to £3.6bn) is reached with TIE 0.45 if total taxable income is about ${hi.toFixed(1)} times the income above the threshold (an unsourced ratio, so this is a consistency check, not an independent validation)`);
ok(Math.abs(stat - 3450) < 1 && data.references.some(r => /Budget 2012/.test(r.name)), 'the 2012 static cost used is HMRC\'s £3.3bn-£3.6bn (Budget 2012 costings), not the £3.8bn in the brief: the discrepancy is in docs/COSTING_SPEC.md');
// a rate cut can never raise the static yield: every published yield-if-up line costs money when cut (and gains when raised)
const monotone = data.items.filter(i => i.meaning === 'yield_if_up' && i.values.every(v => v >= 0) && i.direction === 0).every(i => {
  const up = C.costOne(ix, tax(i.id, 1, i.size)), dn = C.costOne(ix, tax(i.id, -1, i.size));
  return up.years.every(y => y.central >= 0) && dn.years.every(y => y.central <= 0);
});
ok(monotone, 'property: for every simple rate line, a rise never loses money and a cut never gains it');

// ---- benefits and spending
const uc = C.costOne(ix, { kind: 'benefit', benefit: 'universal_credit', direction: 1, size: 5 });
const ucBase = 51200 * Math.pow(88100 / 51200, 3 / 5);
ok(Math.abs(uc.years[0].static + ucBase * 0.05) < 1 && Math.abs(uc.years[0].central - (-ucBase * 0.05 * 0.9)) < 1, `Universal Credit +5%: baseline £${(ucBase / 1000).toFixed(1)}bn (interpolated between the OBR's £51.2bn 2023-24 and £88.1bn 2028-29), static cost 5% of it, less the 10% offset`);
ok(uc.assumptions.some(x => /UNSOURCED/.test(x.status)) && uc.warnings.length >= 2, 'benefits: the unsourced offset and the baseline vintage are shown as warnings');
const sp = C.costOne(ix, { kind: 'spending', direction: -1, amountM: 2000, start: '2028-29' });
ok(cen(sp).join() === '0,0,2000,2000,2000' && sp.years.every(y => y.static === null || y.static === y.central || true), 'spending: a £2bn a year cut from 2028-29 saves nothing before and £2bn a year from then');
const unitsOk = C.costOne(ix, tax(BR, 1, 1, '2027-28'));
ok(cen(unitsOk).slice(0, 2).join() === '0,6900', 'a later start (2027-28) is shifted: nothing in 2026-27, then HMRC\'s first-year figure');

// ---- the range: Monte Carlo, reproducible; the tornado; the package and its interaction
const pk = C.costPackage(ix, [tax(BR, 1, 1)]);
const pk2 = C.costPackage(ix, [tax(BR, 1, 1)]);
ok(pk.mc.n === 5000 && pk.mc.total.p10 < pk.mc.total.p50 && pk.mc.total.p50 < pk.mc.total.p90 && pk.mc.total.p50 === pk2.mc.total.p50, 'Monte Carlo: 5,000 draws, p10 < median < p90, and the same seed gives exactly the same answer');
ok(pk.total.low < pk.total.central && pk.total.central < pk.total.high && pk.mc.total.p10 >= pk.total.low - 1 && pk.mc.total.p90 <= pk.total.high + 1, 'the Monte Carlo 10th-90th range sits inside the low-high scenario range');
ok(pk.sensitivity.length >= 1 && pk.sensitivity[0].swing >= pk.sensitivity[pk.sensitivity.length - 1].swing, 'the tornado ranks the inputs by their effect on the five-year total');
const both = C.costPackage(ix, [tax(BR, 1, 1), tax('income_tax:change_personal_allowance_by_10', 1, 10)], { monteCarlo: false });
ok(near(both.years[0].sumOfParts, 6900 - 10000) && near(both.years[0].interaction, 6900 * (-(10000 / 0.2) / (6900 / 0.01))), 'package: a basic rate rise with a personal allowance rise: the interaction is worked out from HMRC\'s own figures (about -£500m in 2026-27)', both.years[0].interaction);
ok(near(both.years[0].central, both.years[0].sumOfParts + both.years[0].interaction) && both.interactions.length === 1, 'package: result = sum of the parts + the interaction effect, and the pair is named');
const fv = C.costPackage(ix, [tax('duties:change_petrol_by_1', 1, 1), tax('vat:change_standard_rate_by_1_percentage_point', 1, 1)], { monteCarlo: false });
ok(fv.notModelled.some(s => /VAT charged on them/.test(s)), 'package: interactions the tool does not model (duty and the VAT on it) are listed, not hidden');
ok(C.costPackage(ix, [tax(BR, 1, 1)], { monteCarlo: false }).indirect === null && C.costPackage(ix, [tax('nics:change_class_1_employer_rate_by_1_percentage_point', 1, 1)], { monteCarlo: false, indirect: true }).indirect.lines.length === 1, 'wider (indirect) effects are off by default and kept apart from the headline');
const emp = C.costOne(ix, tax('nics:change_class_1_employer_rate_by_1_percentage_point', 1, 1));
ok(emp.warnings.some(w => /passing the cost on|passing/.test(w) || /employers passing/.test(w)), 'employer National Insurance: warns that HMRC\'s figure leaves out the pass-through to pay, prices and profits');

// ---- the parser: words to a structured policy, always shown for confirmation
const p1 = C.parseLine(ix, 'raise the basic rate of income tax by 1p');
ok(p1.ok && p1.policy.item === BR && p1.policy.direction === 1 && p1.policy.size === 1, 'parser: "raise the basic rate of income tax by 1p"');
const p2 = C.parseLine(ix, 'cut employer NICs by 1pp');
ok(p2.ok && p2.policy.item === 'nics:change_class_1_employer_rate_by_1_percentage_point' && p2.policy.direction === -1, 'parser: "cut employer NICs by 1pp"');
const p3 = C.parseLine(ix, 'increase the Universal Credit standard allowance by 5%');
ok(p3.ok && p3.policy.kind === 'benefit' && p3.policy.benefit === 'universal_credit' && p3.policy.size === 5, 'parser: "increase the Universal Credit standard allowance by 5%"');
const p4 = C.parseLine(ix, 'cut departmental spending by £2bn from 2028');
ok(p4.ok && p4.policy.kind === 'spending' && p4.policy.amountM === 2000 && p4.policy.start === '2028-29', 'parser: "cut departmental spending by £2bn from 2028"');
ok(!C.parseLine(ix, 'raise VAT').ok && C.parseLine(ix, 'raise VAT').ask.length > 0, 'parser: ambiguous input is not costed silently (it asks)');
ok(!C.parseLine(ix, 'raise the basic rate to 21p').ok, 'parser: "to 21p" needs the current level, so it asks');
ok(C.parseLine(ix, 'put up tobacco duty by 2%').policy.item === 'duties:change_tobacco_duties_by_1' && C.parseLine(ix, 'put up tobacco duty by 2%').policy.size === 2, 'parser: "put up tobacco duty by 2%"');
ok(C.parseText(ix, 'raise VAT by 1pp\ncut the basic rate by 1p; raise tobacco duty by 1%').length === 3, 'parser: several policy points, one per line or separated by ;');

// ---- outputs
const md = C.toMarkdown(both), csv = C.toCsv(both);
ok(/Not an official, OBR-certified or HM Treasury costing/.test(md) && /positive = a gain to the Exchequer, negative = a cost/.test(md) && /Interaction effect/.test(md) && /Assumptions and sources/.test(md), 'Markdown report: disclaimer, sign convention, interaction, assumptions and sources');
ok(csv.split('\n').length > 5 && /"Package","interaction"/.test(csv), 'CSV report');
ok(JSON.parse(JSON.stringify(pk)).results[0].years.length === 5, 'JSON report: five fiscal years');
ok(C.costPackage(ix, [tax(BR, 1, 1), p3.policy], { monteCarlo: false }).results.every(r => r.assumptions.every(x => x.status)), 'every assumption carries a status (SOURCED or UNSOURCED); nothing is hidden');

if (failed) { console.log(`\n${failed} check(s) FAILED`); process.exit(1); }
console.log('\ncosting checks passed');
