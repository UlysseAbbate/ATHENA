// GET /api/libby/commons/day/:cdate  (cdate = YYYY-MM-DD or "today")
// The House of Commons' business for one day, from the UK Parliament What's On API: the Chamber, Westminster Hall, the general
// (public bill and delegated legislation) committees and the select committees, with the members named (Lib Dem MPs marked),
// the Bill an item is about, the room and the times. (The Commons has no item-by-item business API like the Lords Business API.)

import { json, errorResponse, safe, londonToday, isIsoDate } from '../../../../../lib/libby/util.js';
import { whatsOn, ldMPs, ldMatcher } from '../../../../../lib/libby/parliament.js';
import { commonsSections } from '../../../../../lib/libby/commons.js';

export async function onRequestGet(ctx) {
  const raw = String(ctx.params.cdate || '');
  const date = raw === 'today' ? londonToday() : raw;
  if (!isIsoDate(date)) return json({ error: 'Use a date like 2026-11-03, or "today".' }, { status: 400 });
  try {
    const [events, mps] = await Promise.all([whatsOn(date, date, 'Commons', ctx), safe(ldMPs(ctx), [])]);
    const { sections, rising } = commonsSections(events, ldMatcher(mps));
    return json({
      date, sections, rising,
      source: { label: "UK Parliament — What's On (House of Commons)", url: `https://whatson.parliament.uk/commons/${date}/` },
    }, { maxAge: 300 });
  } catch (err) {
    return errorResponse(err);
  }
}
