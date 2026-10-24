// Saved copies ("snapshots") of the slow Parliament lookups, kept in the api_snapshots table.
//
// The scheduled job (.github/workflows/refresh-data.yml, six times a day: see lib/schedule.js) renews them. A page then
// reads the saved copy in one quick database call instead of searching the Parliament APIs while the person waits.
// A person can still ask for fresh data with the "Refresh now" button: the browser then sends the header `x-refresh: 1`
// and the lookups behind that page are done live and saved again for everyone.
//
//   fresh enough saved copy  -> used as it is
//   no copy / copy too old   -> looked up live (and saved for next time)
//   live lookup fails        -> the old copy is used rather than an error (unless ctx.strict, which the job sets)

import { sbSelect, sbUpsert, supabaseConfigured } from './supabase.js';
import { cached, safe } from './util.js';

/** Someone pressing "Refresh now" cannot make the server redo a lookup that was saved less than this long ago. */
export const MIN_REFRESH_GAP_MS = 60 * 1000;
/** A copy older than this is not trusted (the scheduled job has stopped): the lookup is done live instead. */
export const MAX_AGE_MS = 30 * 60 * 60 * 1000;

/**
 * True when this request wants live data for `key` rather than the saved copy: a person pressed "Refresh now" (the browser
 * sends `x-refresh: 1`), or the scheduled job set ctx.refresh. The job may narrow that with ctx.refreshOnly, a list of key
 * prefixes, so that while it renews the finished pages it does not redo the shared lookups behind them every time.
 */
export function wantsRefresh(ctx, key = '') {
  if (!ctx) return false;
  if (ctx.refresh === true) return !ctx.refreshOnly || ctx.refreshOnly.some((prefix) => key.startsWith(prefix));
  return ctx.request?.headers?.get('x-refresh') === '1';
}

const rowOf = (r) => ({ payload: r.payload, updatedAt: r.updated_at, age: Date.now() - Date.parse(r.updated_at) });

/** True if a saved copy may be used as it is. */
export function usable(row, forced) {
  return !!row && row.age < MAX_AGE_MS && !(forced && row.age > MIN_REFRESH_GAP_MS);
}

export async function readSnapshot(env, key) {
  if (!supabaseConfigured(env)) return null;
  const rows = await sbSelect(env, 'api_snapshots', `select=payload,updated_at&key=eq.${encodeURIComponent(key)}&limit=1`);
  return rows[0] ? rowOf(rows[0]) : null;
}

/** Several saved copies in one call: a Map of key -> { payload, updatedAt, age }. */
export async function readSnapshots(env, keys) {
  const out = new Map();
  if (!supabaseConfigured(env) || !keys.length) return out;
  const list = encodeURIComponent(`(${keys.map((k) => `"${k}"`).join(',')})`);
  const rows = await sbSelect(env, 'api_snapshots', `select=key,payload,updated_at&key=in.${list}`);
  for (const r of rows) out.set(r.key, rowOf(r));
  return out;
}

export async function writeSnapshot(env, key, payload) {
  if (!supabaseConfigured(env)) return;
  await sbUpsert(env, 'api_snapshots', [{ key, payload, updated_at: new Date().toISOString() }]);
}

/**
 * The saved copy for `key`, or the result of `producer()` if there is none worth using.
 * `ttlSeconds` is how long the edge cache may keep a live result (the old behaviour, kept as the fallback layer).
 */
export async function snapshotted(ctx, key, ttlSeconds, producer) {
  const env = ctx && ctx.env;
  if (!env || !supabaseConfigured(env)) return cached(ctx, key, ttlSeconds, producer);

  const forced = wantsRefresh(ctx, key);
  const row = await safe(readSnapshot(env, key), null);
  if (usable(row, forced)) return row.payload;

  let data;
  try {
    data = forced ? await producer() : await cached(ctx, key, ttlSeconds, producer);
  } catch (err) {
    if (row && !ctx.strict) { console.warn(`snapshot ${key}: live lookup failed, using the saved copy (${err.message})`); return row.payload; }
    throw err;
  }

  // An empty list is almost always a hiccup in the source, not the truth: do not save it over a good copy.
  if (Array.isArray(data) && !data.length && row) return row.payload;
  const save = safe(writeSnapshot(env, key, data));
  if (forced || !ctx.waitUntil) await save; else ctx.waitUntil(save);
  return data;
}
