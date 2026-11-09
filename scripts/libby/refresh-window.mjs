#!/usr/bin/env node
// Used by .github/workflows/libby-refresh-data.yml to decide whether this run should do the update.
// GitHub starts scheduled runs hours late, and sometimes drops one, so the workflow is woken several times a day and this answers
// "has the saved Parliament data been renewed since the last 6am or 6pm (London)?": if not, the update is due, however late the run started.
// A run that finds the data already renewed for this slot does nothing. The time of the last renewal is the run note the update writes at the end
// (api_snapshots, key meta:refresh), so a run that failed half way leaves the update due for the next wake-up.
// Prints "go=true" or "go=false" (the format GitHub reads into a step output). Times live in lib/libby/schedule.js.
//   node scripts/libby/refresh-window.mjs           the real answer
//   node scripts/libby/refresh-window.mjs --force   always go (for runs started by hand)

import { lastSlotStart, updateIsDue } from '../../lib/libby/schedule.js';

async function lastUpdate() {
  const { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key } = process.env;
  if (!url || !key) return null;
  const res = await fetch(`${url}/rest/v1/api_snapshots?select=updated_at&key=eq.meta:refresh&limit=1`, { headers: { apikey: key, authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`Supabase answered ${res.status}`);
  return (await res.json())[0]?.updated_at || null;
}

let go = true;
let why = 'started by hand';
if (!process.argv.includes('--force')) {
  try {
    const last = await lastUpdate();
    go = updateIsDue(last);
    why = `the last update was ${last || 'never'}; the slot began ${lastSlotStart().toISOString()}: ${go ? 'an update is due' : 'already updated for this slot, nothing to do'}`;
  } catch (err) {
    why = `could not read the time of the last update (${err.message}), so updating`;
  }
}
console.error(why);
console.log(`go=${go}`);
