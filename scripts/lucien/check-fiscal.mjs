// Checks the marginal rates calculation (site/lucien/fiscal-system.js) against the published rules, and that the rulebook data is complete. Run: node scripts/lucien/check-fiscal.mjs
import fs from 'node:fs';
const ctx = {};
new Function('globalThis', fs.readFileSync(new URL('../../site/lucien/fiscal-system.js', import.meta.url), 'utf8'))(ctx);
const F = ctx.FiscalSystem;
const data = JSON.parse(fs.readFileSync(new URL('../../site/lucien/fiscal-system.json', import.meta.url), 'utf8'));
const m = data.model;
let failed = 0;
const ok = (cond, name) => { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}`); if (!cond) failed++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

ok(near(F.incomeTax(m, 30000), (30000 - 12570) * 0.2) && near(F.incomeTax(m, 12570), 0), 'income tax: 20% above the £12,570 allowance, nothing below');
ok(near(F.incomeTax(m, 60000), 37700 * 0.2 + (60000 - 12570 - 37700) * 0.4), 'income tax: 40% above £50,270');
ok(near(F.incomeTax(m, 125140), 37700 * 0.2 + (125140 - 37700) * 0.4) && near(F.incomeTax(m, 150000), 37700 * 0.2 + (125140 - 37700) * 0.4 + (150000 - 125140) * 0.45), 'income tax: no allowance at £125,140, 45% above');
ok(near(F.employeeNI(m, 30000), (30000 - 12570) * 0.08) && near(F.employeeNI(m, 60000), (50270 - 12570) * 0.08 + (60000 - 50270) * 0.02), 'National Insurance: 8% between £12,570 and £50,270, 2% above');
ok(near(F.studentLoan(m, 40000, 'plan2'), (40000 - 29385) * 0.09) && near(F.studentLoan(m, 25000, 'postgrad'), 4000 * 0.06) && F.studentLoan(m, 40000, 'none') === 0, 'student loan: 9% over the plan threshold, 6% for a postgraduate loan');
ok(near(F.childBenefit(m, 2), (27.05 + 17.9) * 52) && F.hicbc(m, 70000, 2) > 0 && near(F.hicbc(m, 80000, 2), F.childBenefit(m, 2)) && F.hicbc(m, 59000, 2) === 0, 'Child Benefit charge: nothing to £60,000, all of it at £80,000');

const mt = (E, o = {}) => F.marginal(m, E, { children: 0, loan: 'none', ...o });
ok(near(mt(30000).total, 0.28, 1e-3), 'a basic-rate earner keeps 72p of each extra £1 (20% + 8%)');
ok(near(mt(30000, { loan: 'plan2' }).total, 0.37, 1e-3), 'with a Plan 2 loan, 37%');
ok(near(mt(60000).total, 0.42, 1e-3), 'a higher-rate earner: 40% + 2%');
ok(near(mt(110000).total, 0.62, 1e-3) && near(mt(110000).tax, 0.60, 1e-3), 'between £100,000 and £125,140 the effective income tax rate is 60% (62% with National Insurance)');
const withKids = mt(70000, { children: 2 });
ok(near(withKids.hicbc, F.childBenefit(m, 2) / 20000, 1e-3) && near(withKids.total, 0.42 + F.childBenefit(m, 2) / 20000, 1e-3), 'with two children at £70,000 the Child Benefit charge adds about 11.7 points');
ok(near(mt(6000).total, 0.55, 1e-3) && near(mt(6000).uc, 0.55, 1e-3), 'a single person with low earnings loses 55p of Universal Credit for each £1 earned (no work allowance without children)');
const lowKids = mt(14000, { children: 1 });
ok(near(lowKids.uc, 0.55 * 0.72, 1e-3) && near(lowKids.total, 0.28 + 0.55 * 0.72, 1e-3), 'a parent on a low income: the taper applies to take-home pay, so 28% + 55% of the remaining 72% = about 67.6%');
ok(F.position(m, 0, { children: 0 }).net > 5000 && near(F.position(m, 0, { children: 0 }).uc, m.uc_month.standard_single_25 * 12), 'with no earnings a single adult gets the Universal Credit standard allowance for the year');
const c = F.curve(m, { children: 1, loan: 'plan2' });
ok(c.length > 400 && c.every((p) => p.total > -0.0001 && p.total < 1.1), 'the curve covers £0 to £130,000 with every rate between 0 and 110%');

// the rulebook
const items = data.groups.flatMap((g) => g.items);
ok(items.length >= 40 && items.every((i) => i.name && i.summary && i.parts.length && i.parts.every((p) => p.label && p.value && data.sources[p.source])), 'every rule has a label, a value and a source that is listed');
ok(!JSON.stringify(data).includes('"?"') && !JSON.stringify(data).includes('?'), 'no placeholder values are left in the rulebook');
ok(items.filter((i) => i.kind === 'benefit').every((i) => i.parts.length >= 1) && items.some((i) => i.id === 'universal-credit') && items.some((i) => i.id === 'income-tax'), 'taxes and welfare are both there');
ok(/^\d{4}-\d{2}-\d{2}$/.test(data.retrieved) && Array.isArray(data.gaps) && data.gaps.length > 0 && /not .*costing/i.test(data.notice), 'it says when it was read, what it does not cover, and that it is not a costing');

console.log(failed ? `\n${failed} check(s) failed` : '\nAll fiscal system checks passed.');
process.exit(failed ? 1 : 0);
