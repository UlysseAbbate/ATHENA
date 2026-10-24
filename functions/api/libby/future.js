// GET /api/future?from=YYYY-MM-DD&days=28
// The Lords calendar: for each day, the primary legislation (Bills) listed for that day, from the
// Whips' Forthcoming Business (stored in Supabase by the GitHub Action) and the What's On calendar.
// Each day links to /day/:date, which shows the full business.

import { json, safe, londonToday, addDays, isIsoDate } from '../../../lib/libby/util.js';
import { whatsOn, activeLordsBillsTagged } from '../../../lib/libby/parliament.js';
import { tagText } from '../../../lib/libby/portfolios.js';
import { sectionsFromWhatsOn, sectionsFromFB, itemCount, matchBill } from '../../../lib/libby/business.js';
import { fbRows } from '../../../lib/libby/supabase.js';
import { snapshotted } from '../../../lib/libby/snapshots.js';
import { SAVED_FUTURE_LENGTHS } from '../../../lib/libby/schedule.js';

// The calendar shows primary legislation only. Secondary legislation, Oral Questions, statements,
// debates, introductions and anything unclassified are left out (they're all on the day's own page).
const CALENDAR_KINDS = new Set(['legislation']);

/** The calendar for `days` days from `from`. */
async function buildFuture(ctx, from, days) {
  const { env } = ctx;
  const to = addDays(from, days - 1);

  const [events, fb, billList] = await Promise.all([
    safe(whatsOn(from, to, 'Lords', ctx), []),
    safe(fbRows(env, from, to), []),
    safe(activeLordsBillsTagged(ctx), []),
  ]);
  // A Bill listed on the calendar carries the Bill's own portfolio; anything else is placed by its wording, and never left without one.
  const portfoliosOf = (i) => (matchBill(i.title, billList)?.portfolios) || (i.portfolios?.length ? i.portfolios : tagText(i.title).codes);

  const byDate = new Map();
  const bucket = (d) => { if (!byDate.has(d)) byDate.set(d, { events: [], fb: [] }); return byDate.get(d); };
  for (const e of events) if (e.date) bucket(e.date).events.push(e);
  for (const r of fb) bucket(r.business_date).fb.push(r);

  const out = [];
  for (const [date, v] of [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const wo = sectionsFromWhatsOn(v.events);
    const fbS = sectionsFromFB(v.fb);
    const useFB = itemCount(fbS) >= itemCount(wo);
    const sections = useFB ? fbS : wo;
    const count = itemCount(sections);
    if (!count) continue;
    const items = sections.flatMap((s) => s.items.map((i) => ({ kind: i.kind, title: i.title, section: s.name, portfolios: i.portfolios })));
    // Bills only, each listed once even if it appears in both the Chamber and Grand Committee.
    const seen = new Set();
    const bills = items.filter((i) => CALENDAR_KINDS.has(i.kind) && !seen.has(i.title) && seen.add(i.title));
    out.push({
      date,
      source: useFB ? 'Forthcoming Business' : "What's On",
      count,
      highlights: bills.slice(0, 8).map((i) => ({ ...i, portfolios: portfoliosOf(i) })),
    });
  }
  return { from, to, days: out, fbLoaded: fb.length > 0 };
}

export async function onRequestGet(ctx) {
  const q = new URL(ctx.request.url).searchParams;
  const today = londonToday();
  const from = isIsoDate(q.get('from')) ? q.get('from') : today;
  const days = Math.min(Math.max(Number(q.get('days')) || 28, 7), 63);

  if (from !== today || !SAVED_FUTURE_LENGTHS.includes(days)) return json(await buildFuture(ctx, from, days), { maxAge: 900 });

  const data = await snapshotted(ctx, `future:${days}`, 900, () => buildFuture(ctx, from, days));
  // A copy made last night starts yesterday: drop the days that have gone.
  return json({ ...data, from: today, days: data.days.filter((d) => d.date >= today) }, { maxAge: 900 });
}
