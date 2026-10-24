// GET /api/live — what is happening right now in the Chamber and in Grand Committee.
// Chamber: the Lords annunciator (now-api.parliament.uk, LordsMain).
// Grand Committee has no annunciator feed, so we infer the current item from today's
// What's On schedule by start time.

import { json, safe, cached, londonToday, londonMinutesNow, pick } from '../../../lib/libby/util.js';
import { annunciator, whatsOn } from '../../../lib/libby/parliament.js';

const toMinutes = (t) => {
  const m = String(t || '').match(/(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

export async function onRequestGet(ctx) {
  const today = londonToday();
  const [chamber, events] = await Promise.all([
    safe(cached(ctx, 'annunciator-LordsMain', 20, () => annunciator('LordsMain')), null), // one lookup shared by everyone watching
    safe(whatsOn(today, today, 'Lords', ctx), []),
  ]);

  const gc = events.filter((e) => e.section === 'Grand Committee' && e.start)
    .sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  const now = londonMinutesNow();
  let current = null;
  let next = null;
  for (const e of gc) {
    const s = toMinutes(e.start);
    const end = toMinutes(e.end);
    if (s <= now && (end === null || now < end)) current = e;
    if (s > now && !next) next = e;
  }
  const summarise = (e) => e && { title: e.title, start: e.start, end: e.end };

  return json({
    date: today,
    chamber: chamber
      ? { available: true, publishTime: pick(chamber, 'publishTime'), lines: chamber.lines }
      : { available: false, lines: [] },
    grandCommittee: {
      sittingToday: gc.length > 0,
      current: summarise(current),
      next: summarise(next),
      note: 'Inferred from the published Grand Committee schedule; there is no live Grand Committee feed.',
    },
  }, { maxAge: 30 });
}
