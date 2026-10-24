// GET /api/status — how fresh the saved Parliament data is, for the line at the foot of every page:
//   updated   when the list of Bills (the main saved copy) was last renewed, by the scheduled job or by "Refresh now"
//   lastRun   how the last scheduled run went: { at, seconds, failed: [names of lookups that did not work] }
//   next      the next scheduled update: { hour, tomorrow } in London time (times are in lib/schedule.js)
// Anyone signed in may read it.

import { json, errorResponse, safe } from '../../../lib/libby/util.js';
import { sbSelect, supabaseConfigured } from '../../../lib/libby/supabase.js';
import { nextRefresh, REFRESH_HOURS } from '../../../lib/libby/schedule.js';

export async function onRequestGet({ env }) {
  try {
    let updated = null;
    let lastRun = null;
    if (supabaseConfigured(env)) {
      const rows = await safe(sbSelect(env, 'api_snapshots', 'select=key,payload,updated_at&key=in.(%22active-lords-bills%22,%22meta:refresh%22)'), []);
      updated = rows.find((r) => r.key === 'active-lords-bills')?.updated_at || null;
      lastRun = rows.find((r) => r.key === 'meta:refresh')?.payload || null;
    }
    return json({ updated, lastRun, next: nextRefresh(), hours: REFRESH_HOURS }, { maxAge: 0 });
  } catch (err) {
    return errorResponse(err);
  }
}
