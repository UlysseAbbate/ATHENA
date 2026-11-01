// The room booking system (the Wallace Room and Room 391; ?room=wallace|391, default wallace).
//   GET  /api/room-bookings?from=YYYY-MM-DD&to=YYYY-MM-DD   -> { bookings: [ { id, seriesId, peer, note, date, start, end } ], series: { id: { rule } } }
//   POST /api/room-bookings { action: 'book', peer, date, start, end, note, repeat?: { every, days, until }, skipConflicts? }
//   POST /api/room-bookings { action: 'cancel', id, as, scope: 'one' | 'following' | 'all' }
// Everyone signed in can see every booking and book. Only the Peers' level is needed (see pages.js).
// Shared codes cannot prove who someone is, so "as" (the name chosen on the page) is a record, not a login:
// a booking can be cancelled by the name it was made under, or by Staff or an Admin.
// The database itself refuses overlapping bookings (an exclusion constraint on room_bookings), so two people booking the
// same slot at the same moment cannot both succeed. The opening hours and limits are in public/js/wallace-rules.js.

import { json, errorResponse, isIsoDate, londonToday, londonMinutesNow, addDays } from '../../../lib/libby/util.js';
import { sbSelect, supabaseConfigured } from '../../../lib/libby/supabase.js';
import { passcodeProblem, cleanLine } from '../../../lib/libby/auth.js';
import { levelFromRequest, atLeast } from '../../../lib/libby/access.js';
import {
  validTime, toMinutes, overlaps, expandRecurrence, weekdayOf,
  MAX_DAYS_AHEAD, MAX_NOTE_LENGTH,
} from '../../../site/libby/js/wallace-rules.js';

const MAX_SPAN_DAYS = 70;
const COLUMNS = 'id,series_id,peer,note,start_at,end_at';
const ROOMS = ['wallace', '391'];
const roomOf = (v) => (ROOMS.includes(String(v)) ? String(v) : 'wallace');

const toBooking = (r) => ({
  id: r.id, seriesId: r.series_id || null, peer: r.peer, note: r.note || '',
  date: r.start_at.slice(0, 10), start: r.start_at.slice(11, 16), end: r.end_at.slice(11, 16),
});
const wHeaders = (env, prefer = 'return=minimal') => ({
  apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', prefer,
});
const posInt = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : 0; };
const missingTable = (err) => /room_(bookings|series)/.test(String(err.message)) && /does not exist|relation|schema cache/.test(String(err.message));
const fail = (message, status = 400, extra = {}) => json({ error: message, ...extra }, { status });

export async function onRequestGet({ request, env }) {
  const q = new URL(request.url).searchParams;
  const room = roomOf(q.get('room'));
  const from = isIsoDate(q.get('from')) ? q.get('from') : londonToday();
  let to = isIsoDate(q.get('to')) ? q.get('to') : addDays(from, 34);
  if (to < from) to = from;
  if (to > addDays(from, MAX_SPAN_DAYS - 1)) to = addDays(from, MAX_SPAN_DAYS - 1);
  if (!supabaseConfigured(env)) return fail('Supabase settings are missing in Cloudflare.', 503);
  try {
    const rows = await sbSelect(env, 'room_bookings',
      `select=${COLUMNS}&room=eq.${room}&start_at=gte.${from}T00:00:00&start_at=lt.${addDays(to, 1)}T00:00:00&order=start_at.asc&limit=2000`);
    const seriesIds = [...new Set(rows.map((r) => r.series_id).filter(Boolean))];
    const series = {};
    if (seriesIds.length) {
      for (const s of await sbSelect(env, 'room_series', `select=id,peer,rule&id=in.(${seriesIds.join(',')})`)) series[s.id] = { peer: s.peer, rule: s.rule };
    }
    return json({ room, from, to, bookings: rows.map(toBooking), series });
  } catch (err) {
    if (missingTable(err)) return fail('The room booking tables have not been created yet: run schema.sql in Supabase.', 503);
    return errorResponse(err);
  }
}

/** Book the room once, or on a repeating pattern. */
async function book(env, body) {
  const room = roomOf(body.room);
  const peer = cleanLine(body.peer, 80);
  if (!peer) return fail('Choose your name first.');
  const date = body.date;
  const start = String(body.start || '');
  const end = String(body.end || '');
  if (!isIsoDate(date)) return fail('Choose a date.');
  if (!validTime(start) || !validTime(end, { end: true }) || toMinutes(end) <= toMinutes(start)) {
    return fail('Choose a start and end time on the half hour, within the room\u2019s opening hours, with the end after the start.');
  }
  const today = londonToday();
  if (date < today) return fail('That date has already passed.');
  if (date === today && toMinutes(start) < londonMinutesNow()) return fail('That time has already passed today.');
  if (date > addDays(today, MAX_DAYS_AHEAD)) return fail(`The room can only be booked up to ${MAX_DAYS_AHEAD} days ahead.`);
  const note = cleanLine(body.note, MAX_NOTE_LENGTH);

  const repeat = body.repeat && typeof body.repeat === 'object' && body.repeat.until ? {
    every: body.repeat.every, days: body.repeat.days, until: String(body.repeat.until),
  } : null;
  const { dates, error } = expandRecurrence(date, repeat);
  if (error) return fail(error);

  // Which dates are already taken at that time?
  const existing = await sbSelect(env, 'room_bookings',
    `select=${COLUMNS}&room=eq.${room}&start_at=gte.${dates[0]}T00:00:00&start_at=lt.${addDays(dates[dates.length - 1], 1)}T00:00:00&order=start_at.asc&limit=2000`);
  const clashes = [];
  const free = [];
  for (const d of dates) {
    const hit = existing.map(toBooking).find((b) => b.date === d && overlaps(start, end, b.start, b.end));
    if (hit) clashes.push({ date: d, start: hit.start, end: hit.end, peer: hit.peer }); else free.push(d);
  }
  if (clashes.length && !body.skipConflicts) {
    return fail(dates.length === 1 ? `That time is already booked by ${clashes[0].peer}.` : `${clashes.length} of ${dates.length} dates clash with existing bookings.`, 409, { clashes, total: dates.length, free: free.length });
  }
  if (!free.length) return fail('Every one of those dates is already booked.', 409, { clashes, total: dates.length, free: 0 });

  // A repeating booking keeps a record of its rule, so it can be described and cancelled as a series.
  let seriesId = null;
  if (repeat && dates.length > 1) {
    const rule = { from: date, until: repeat.until, every: Math.min(4, Math.max(1, Math.floor(Number(repeat.every)) || 1)), days: [...new Set([...(Array.isArray(repeat.days) ? repeat.days.map(Number) : []), weekdayOf(date)])].filter((d) => d >= 0 && d <= 6).sort(), start, end };
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/room_series`, { method: 'POST', headers: wHeaders(env, 'return=representation'), body: JSON.stringify([{ peer, note: note || null, rule, room }]) });
    if (!res.ok) throw new Error(`Supabase room_series: ${res.status} ${await res.text()}`);
    seriesId = (await res.json())[0].id;
  }
  const rows = free.map((d) => ({ series_id: seriesId, room, peer, note: note || null, start_at: `${d}T${start}:00`, end_at: `${d}T${end}:00` }));
  const ins = await fetch(`${env.SUPABASE_URL}/rest/v1/room_bookings`, { method: 'POST', headers: wHeaders(env, 'return=representation'), body: JSON.stringify(rows) });
  if (!ins.ok) {
    if (seriesId) await fetch(`${env.SUPABASE_URL}/rest/v1/room_series?id=eq.${seriesId}`, { method: 'DELETE', headers: wHeaders(env) });
    if (ins.status === 409) return fail('Someone has just booked part of that time. Reload the page and try again.', 409, { clashes: [], total: dates.length, free: 0, raced: true });
    throw new Error(`Supabase room_bookings: ${ins.status} ${await ins.text()}`);
  }
  const made = await ins.json();
  return json({ ok: true, created: made.length, skipped: clashes.length, seriesId, ids: made.map((r) => r.id) });
}

/** Cancel one booking, the rest of its series, or all its future bookings. */
async function cancel(env, body, isAdmin) {
  const id = posInt(body.id);
  if (!id) return fail('Unknown booking.');
  const [row] = await sbSelect(env, 'room_bookings', `select=${COLUMNS}&id=eq.${id}`);
  if (!row) return fail('That booking has already been cancelled.', 404);
  const as = cleanLine(body.as, 80);
  if (!isAdmin && (!as || as !== row.peer)) return fail(`Only ${row.peer} (booking as their name) or Staff or an Admin can cancel this booking.`, 403);

  const scope = ['following', 'all'].includes(body.scope) && row.series_id ? body.scope : 'one';
  let filter = `id=eq.${id}`;
  if (scope === 'following') filter = `series_id=eq.${row.series_id}&start_at=gte.${row.start_at}`;
  if (scope === 'all') filter = `series_id=eq.${row.series_id}&start_at=gte.${londonToday()}T00:00:00`;
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/room_bookings?${filter}`, { method: 'DELETE', headers: wHeaders(env, 'return=representation') });
  if (!res.ok) throw new Error(`Supabase room_bookings: ${res.status} ${await res.text()}`);
  const gone = await res.json();
  return json({ ok: true, cancelled: gone.length, scope });
}

export async function onRequestPost({ request, env }) {
  const refused = await passcodeProblem(request, env);
  if (refused) return refused;
  let body;
  try { body = await request.json(); } catch { return fail('Send JSON.'); }
  if (!supabaseConfigured(env)) return fail('Supabase settings are missing in Cloudflare.', 503);
  try {
    if (body.action === 'book') return await book(env, body);
    if (body.action === 'cancel') return await cancel(env, body, atLeast(await levelFromRequest(request, env), 'staff'));
    return fail('Unknown action.');
  } catch (err) {
    if (missingTable(err)) return fail('The room booking tables have not been created yet: run schema.sql in Supabase.', 503);
    return errorResponse(err);
  }
}
