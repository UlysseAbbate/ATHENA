// GET /api/bill-next?ids=4065,4139,...   (up to 100 Bill ids per request)
// The next scheduled sitting for each Bill, from the Bills API stage sittings: the same dates that
// bills.parliament.uk shows on a Bill's stage pages (e.g. "Report stage, Sitting 20 October").
// The stages of every Bill are saved by the scheduled job (see lib/snapshots.js), so normally every answer comes from one
// quick database call. A Bill with no saved copy is looked up live, at most 12 per request (Cloudflare limits how many
// outside calls a request may make); the rest are listed in `missing` and the page asks again for those.

import { json, errorResponse, londonToday } from '../../../lib/libby/util.js';
import { billStagesMany } from '../../../lib/libby/parliament.js';

const MAX_IDS = 100;
const LIVE_BUDGET = 12;

/** Earliest sitting on or after `today` across all of a Bill's stages. */
function nextSitting(stages, today) {
  let best = null;
  for (const s of stages) {
    for (const d of s.dates) {
      if (d >= today && (!best || d < best.date)) {
        best = { date: d, stage: s.description, house: s.house, source: 'bills.parliament.uk' };
      }
    }
  }
  return best;
}

export async function onRequestGet(ctx) {
  try {
    const raw = new URL(ctx.request.url).searchParams.get('ids') || '';
    const ids = [...new Set(raw.split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, MAX_IDS);
    if (!ids.length) return json({ error: 'Pass ?ids=<bill ids, comma separated>.' }, { status: 400 });

    const today = londonToday();
    const { stages, missing, failed } = await billStagesMany(ctx, ids, LIVE_BUDGET);
    const dates = {};
    for (const [id, list] of Object.entries(stages)) {
      const next = nextSitting(list || [], today);
      if (next) dates[id] = next;
    }
    return json({ dates, failed, missing }, { maxAge: 0 });
  } catch (err) {
    return errorResponse(err);
  }
}
