// GET /api/libby/commons/portfolios/:code: what the House of Commons has before it for one Government department area (the portfolios are the
// same as the Lords' ones, lib/libby/portfolios.js): the live Bills in the Commons, the Oral Questions to the department and the legislation
// on the order paper in the coming weeks, from the What's On calendar.
import { json, errorResponse, safe, londonToday, addDays } from '../../../../../lib/libby/util.js';
import { PORTFOLIO_BY_CODE, classifyPortfolios, portfoliosForDepartment } from '../../../../../lib/libby/portfolios.js';
import { activeBillsTagged, billTypes, whatsOn } from '../../../../../lib/libby/parliament.js';
import { commonsSections } from '../../../../../lib/libby/commons.js';
import { snapshotted } from '../../../../../lib/libby/snapshots.js';

const DAYS = 42;

async function build(ctx, p) {
  const today = londonToday();
  const [bills, types, events] = await Promise.all([
    safe(activeBillsTagged(ctx, 'Commons'), []), safe(billTypes(ctx), []), safe(whatsOn(today, addDays(today, DAYS - 1), 'Commons', ctx), []),
  ]);
  const typeName = Object.fromEntries(types.map((t) => [t.id, t.name]));
  const primary = bills.filter((b) => b.portfolios.includes(p.code)).map((b) => ({ ...b, typeName: typeName[b.billTypeId] || '',
    category: /government/i.test(typeName[b.billTypeId] || '') ? 'government' : 'other' }));

  const byDate = new Map();
  for (const e of events) if (e.date && (e.section === 'Chamber' || e.section === 'Westminster Hall')) (byDate.get(e.date) || byDate.set(e.date, []).get(e.date)).push(e);
  const oralQuestions = [], legislation = [];
  for (const [date, evs] of [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    for (const s of commonsSections(evs).sections) for (const i of s.items) {
      if (i.kind === 'oq' && (portfoliosForDepartment(i.title).includes(p.code) || classifyPortfolios(i.title).includes(p.code))) oralQuestions.push({ date, department: i.title, start: i.start });
      if (i.kind === 'legislation' && classifyPortfolios(i.title).includes(p.code)) legislation.push({ date, title: i.title, billId: i.billId, start: i.start });
    }
  }
  return { code: p.code, name: p.name, primaryLegislation: primary, oralQuestions, legislation, policyLink: `#/policy?portfolio=${p.code}` };
}

export async function onRequestGet(ctx) {
  const p = PORTFOLIO_BY_CODE[String(ctx.params.pcode || '').toUpperCase()];
  if (!p) return json({ error: 'Unknown portfolio.' }, { status: 404 });
  try {
    return json(await snapshotted(ctx, `commons-portfolio:${p.code}`, 900, () => build(ctx, p)), { maxAge: 900 });
  } catch (err) {
    return errorResponse(err);
  }
}
