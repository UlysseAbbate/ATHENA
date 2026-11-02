// GET /api/libby/commons/annunciator: what is happening right now in the Commons Chamber and in Westminster Hall.
// Chamber: the Commons annunciator (now-api.parliament.uk, CommonsMain). Westminster Hall has no feed here, so the current and next item
// are inferred from today's What's On schedule by start time (like the Lords' Grand Committee).
import { json, safe, cached, londonToday, londonMinutesNow, pick } from '../../../../lib/libby/util.js';
import { annunciator, whatsOn } from '../../../../lib/libby/parliament.js';

const toMinutes = (t) => {
  const m = String(t || '').match(/(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

export async function onRequestGet(ctx) {
  const today = londonToday();
  const [chamber, events] = await Promise.all([
    safe(cached(ctx, 'annunciator-CommonsMain', 20, () => annunciator('CommonsMain')), null),
    safe(whatsOn(today, today, 'Commons', ctx), []),
  ]);
  const wh = events.filter((e) => e.section === 'Westminster Hall' && e.start && e.title).sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  const now = londonMinutesNow();
  let current = null;
  let next = null;
  for (const e of wh) {
    const s = toMinutes(e.start);
    const end = toMinutes(e.end);
    if (s <= now && (end === null || now < end)) current = e;
    if (s > now && !next) next = e;
  }
  const summarise = (e) => e && { title: e.title, start: e.start, end: e.end };
  return json({
    date: today,
    chamber: chamber ? { available: true, publishTime: pick(chamber, 'publishTime'), lines: chamber.lines } : { available: false, lines: [] },
    secondary: { name: 'Westminster Hall', sittingToday: wh.length > 0, current: summarise(current), next: summarise(next),
      note: 'Inferred from the published Westminster Hall schedule; there is no live feed for it here.' },
  }, { maxAge: 30 });
}
