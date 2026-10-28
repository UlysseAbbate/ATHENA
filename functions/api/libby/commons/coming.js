// GET /api/libby/commons/coming?from=YYYY-MM-DD&days=28
// The coming House of Commons business, day by day: what is in the Chamber and in Westminster Hall (the committees are on each day's page).
import { json, errorResponse, safe, londonToday, addDays, isIsoDate } from '../../../../lib/libby/util.js';
import { whatsOn, ldMPs, ldMatcher } from '../../../../lib/libby/parliament.js';
import { commonsSections } from '../../../../lib/libby/commons.js';

export async function onRequestGet(ctx) {
  const q = new URL(ctx.request.url).searchParams;
  const from = isIsoDate(q.get('from') || '') ? q.get('from') : londonToday();
  const days = Math.min(Math.max(Number(q.get('days')) || 28, 1), 56);
  const to = addDays(from, days - 1);
  try {
    const [events, mps] = await Promise.all([whatsOn(from, to, 'Commons', ctx), safe(ldMPs(ctx), [])]);
    const isLD = ldMatcher(mps);
    const byDate = new Map();
    for (const e of events) if (e.date && (e.section === 'Chamber' || e.section === 'Westminster Hall')) (byDate.get(e.date) || byDate.set(e.date, []).get(e.date)).push(e);
    const out = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, evs]) => ({ date, ...commonsSections(evs, isLD) }));
    return json({ from, to, days: out }, { maxAge: 600 });
  } catch (err) {
    return errorResponse(err);
  }
}
