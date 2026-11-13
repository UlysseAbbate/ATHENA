// The room booking system (the Wallace Room and Room 391; ?room=wallace|391, default wallace).
//   GET  /api/room-bookings?room=&from=YYYY-MM-DD&to=YYYY-MM-DD   -> { bookings: [ { id, seriesId, peer, note, date, start, end, locked, mine, manage, requested } ], series: { id: { rule } } }
//   POST /api/room-bookings { action: 'book', peer, date, start, end, note, locked?, repeat?: { every, days, until }, skipConflicts? }
//   POST /api/room-bookings { action: 'cancel', id, as, scope: 'one' | 'following' | 'all' }
//   POST /api/room-bookings { action: 'amend', id, date?, start?, end?, note?, locked? }     change one booking (its owner, or the Whips and above)
//   POST /api/room-bookings { action: 'lock', id, locked, scope: 'one' | 'following' | 'all' } set a booking "in stone" (or free it again)
// Who booked, and the note, are seen by the Whips and above, by the account that made the booking, and by the people in a team with that account (see teams.js: view only);
// everyone else with access sees only that the
// slot is booked ("peer" and "note" come back empty), and may ask for it (see room-requests.js) unless it is set in stone.
// Shared codes cannot prove who someone is, so "as" (the name chosen on the page) is only a record: bookings belong to the ACCOUNT that made them
// (booked_by_email; everyone using one shared code is one account). A booking made before that was recorded can still be cancelled by the name it was made under.
// The database itself refuses overlapping bookings (an exclusion constraint on room_bookings), so two people booking the
// same slot at the same moment cannot both succeed. The opening hours and limits are in public/js/wallace-rules.js.

import { json, errorResponse, safe, isIsoDate, londonToday, londonMinutesNow, addDays } from '../../../lib/libby/util.js';
import { sbSelect, supabaseConfigured } from '../../../lib/libby/supabase.js';
import { passcodeProblem, cleanLine } from '../../../lib/libby/auth.js';
import { atLeast } from '../../../lib/libby/access.js';
import { identityFromRequest } from '../../../lib/libby/identity.js';
import {
  validTime, toMinutes, overlaps, expandRecurrence, weekdayOf,
  MAX_DAYS_AHEAD, MAX_NOTE_LENGTH,
} from '../../../site/libby/js/wallace-rules.js';

const MAX_SPAN_DAYS = 70;
const COLUMNS = 'id,series_id,peer,note,start_at,end_at,booked_by_email,locked';
const ROOMS = ['wallace', '391'];
const roomOf = (v) => (ROOMS.includes(String(v)) ? String(v) : 'wallace');

/** Who is asking: { level, email } from the front door's check, or looked up here when this route is called directly. */
async function viewerOf(request, env, data) {
  if (data && data.level !== undefined) return { level: data.level, email: data.email || '' };
  try { const who = await identityFromRequest(request, env); return { level: (who && who.level) || '', email: (who && who.email) || '' }; } catch { return { level: '', email: '' }; }
}
/** May this viewer change the booking? The Whips and above, and the account that made it. (Teammates can only look.) */
export const isOwner = (row, viewer) => !!viewer.email && !!row.booked_by_email && row.booked_by_email === viewer.email;
export const mayManage = (row, viewer) => atLeast(viewer.level, 'whips') || isOwner(row, viewer);
/** May this viewer see who booked and the note? Whoever may change it, and the people in a team with the account that made it (viewer.team: the emails of the viewer's teammates). */
export const maySee = (row, viewer) => mayManage(row, viewer) || (!!row.booked_by_email && !!viewer.team && viewer.team.has(row.booked_by_email));

/** The viewer's teammates (everyone in a team with them) and the names of their teams. Never touches their level. */
async function withTeam(env, viewer) {
  if (!viewer.email) return { ...viewer, team: new Set(), teams: [] };
  const mine = await safe(sbSelect(env, 'libby_team_members', `select=team_id&email=eq.${encodeURIComponent(viewer.email)}`), []);
  if (!mine.length) return { ...viewer, team: new Set(), teams: [] };
  const ids = [...new Set(mine.map((m) => m.team_id))];
  const [others, names] = await Promise.all([
    safe(sbSelect(env, 'libby_team_members', `select=email&team_id=in.(${ids.join(',')})&limit=2000`), []),
    safe(sbSelect(env, 'libby_teams', `select=name&id=in.(${ids.join(',')})&order=name.asc`), []),
  ]);
  return { ...viewer, team: new Set(others.map((o) => o.email).filter((e) => e !== viewer.email)), teams: names.map((n) => n.name) };
}
const timesOf = (r) => ({ date: r.start_at.slice(0, 10), start: r.start_at.slice(11, 16), end: r.end_at.slice(11, 16) });
/** A booking as this viewer may see it: the whole thing for the Whips and the owner, otherwise only that the slot is taken. */
export const toBooking = (r, viewer = { level: 'admin', email: '' }) => {
  const manage = mayManage(r, viewer);
  const visible = maySee(r, viewer);
  return {
    id: r.id, seriesId: visible ? (r.series_id || null) : null, ...timesOf(r), locked: !!r.locked, mine: isOwner(r, viewer), manage, visible, team: visible && !manage,
    peer: visible ? r.peer : '', note: visible ? (r.note || '') : '',
  };
};
const wHeaders = (env, prefer = 'return=minimal') => ({
  apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', prefer,
});
const posInt = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : 0; };
const missingTable = (err) => /room_(bookings|series)/.test(String(err.message)) && /does not exist|relation|schema cache/.test(String(err.message));
const fail = (message, status = 400, extra = {}) => json({ error: message, ...extra }, { status });

export async function onRequestGet({ request, env, data }) {
  const viewer = await withTeam(env, await viewerOf(request, env, data));
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
    const shown = rows.map((r) => toBooking(r, viewer));
    const seriesIds = [...new Set(shown.map((b) => b.seriesId).filter(Boolean))];   // only the series the viewer may see
    const series = {};
    if (seriesIds.length) {
      for (const s of await sbSelect(env, 'room_series', `select=id,peer,rule&id=in.(${seriesIds.join(',')})`)) series[s.id] = { peer: s.peer, rule: s.rule };
    }
    // the slots this person has already asked for, so the page can say so
    if (viewer.email && rows.length && !atLeast(viewer.level, 'whips')) {
      const mine = await safe(sbSelect(env, 'room_requests', `select=booking_id&requester_email=eq.${encodeURIComponent(viewer.email)}&status=eq.open&booking_id=in.(${rows.map((r) => r.id).join(',')})`), []);
      const asked = new Set(mine.map((m) => m.booking_id));
      for (const b of shown) if (asked.has(b.id)) b.requested = true;
    }
    return json({ room, from, to, bookings: shown, series, level: viewer.level, teams: viewer.teams || [] });
  } catch (err) {
    if (missingTable(err)) return fail('The room booking tables have not been created yet: run schema.sql in Supabase.', 503);
    return errorResponse(err);
  }
}

/** Book the room once, or on a repeating pattern. */
async function book(env, body, viewer) {
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
    const hit = existing.map((r) => toBooking(r, viewer)).find((b) => b.date === d && overlaps(start, end, b.start, b.end));
    if (hit) clashes.push({ date: d, start: hit.start, end: hit.end, peer: hit.visible ? hit.peer : '' }); else free.push(d);   // who holds it is not for everyone to know
  }
  if (clashes.length && !body.skipConflicts) {
    return fail(dates.length === 1 ? `That time is already booked${clashes[0].peer ? ` by ${clashes[0].peer}` : ''}.` : `${clashes.length} of ${dates.length} dates clash with existing bookings.`, 409, { clashes, total: dates.length, free: free.length });
  }
  if (!free.length) return fail('Every one of those dates is already booked.', 409, { clashes, total: dates.length, free: 0 });

  // A repeating booking keeps a record of its rule, so it can be described and cancelled as a series.
  let seriesId = null;
  if (repeat && dates.length > 1) {
    const rule = { from: date, until: repeat.until, every: Math.min(4, Math.max(1, Math.floor(Number(repeat.every)) || 1)), days: [...new Set([...(Array.isArray(repeat.days) ? repeat.days.map(Number) : []), weekdayOf(date)])].filter((d) => d >= 0 && d <= 6).sort(), start, end };
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/room_series`, { method: 'POST', headers: wHeaders(env, 'return=representation'), body: JSON.stringify([{ peer, note: note || null, rule, room, booked_by_email: viewer.email || null }]) });
    if (!res.ok) throw new Error(`Supabase room_series: ${res.status} ${await res.text()}`);
    seriesId = (await res.json())[0].id;
  }
  const rows = free.map((d) => ({ series_id: seriesId, room, peer, note: note || null, start_at: `${d}T${start}:00`, end_at: `${d}T${end}:00`, booked_by_email: viewer.email || null, locked: !!body.locked }));
  const ins = await fetch(`${env.SUPABASE_URL}/rest/v1/room_bookings`, { method: 'POST', headers: wHeaders(env, 'return=representation'), body: JSON.stringify(rows) });
  if (!ins.ok) {
    if (seriesId) await fetch(`${env.SUPABASE_URL}/rest/v1/room_series?id=eq.${seriesId}`, { method: 'DELETE', headers: wHeaders(env) });
    if (ins.status === 409) return fail('Someone has just booked part of that time. Reload the page and try again.', 409, { clashes: [], total: dates.length, free: 0, raced: true });
    throw new Error(`Supabase room_bookings: ${ins.status} ${await ins.text()}`);
  }
  const made = await ins.json();
  return json({ ok: true, created: made.length, skipped: clashes.length, seriesId, ids: made.map((r) => r.id) });
}

/** The rows a change applies to: this booking, the rest of its series, or all its future bookings. */
const scopeFilter = (row, scope) => {
  const s = ['following', 'all'].includes(scope) && row.series_id ? scope : 'one';
  if (s === 'following') return { scope: s, filter: `series_id=eq.${row.series_id}&start_at=gte.${row.start_at}` };
  if (s === 'all') return { scope: s, filter: `series_id=eq.${row.series_id}&start_at=gte.${londonToday()}T00:00:00` };
  return { scope: s, filter: `id=eq.${row.id}` };
};
/** Tell the people waiting for these bookings what happened to them (never stops the change itself). */
async function settleRequests(env, ids, status, response) {
  if (!ids.length) return;
  await safe(fetch(`${env.SUPABASE_URL}/rest/v1/room_requests?booking_id=in.(${ids.join(',')})&status=eq.open`, { method: 'PATCH', headers: wHeaders(env),
    body: JSON.stringify({ status, response, responded_at: new Date().toISOString() }) }), null);
}
const lookup = async (env, id) => (await sbSelect(env, 'room_bookings', `select=${COLUMNS}&id=eq.${id}`))[0];

/** Cancel one booking, the rest of its series, or all its future bookings. */
async function cancel(env, body, viewer) {
  const id = posInt(body.id);
  if (!id) return fail('Unknown booking.');
  const row = await lookup(env, id);
  if (!row) return fail('That booking has already been cancelled.', 404);
  const as = cleanLine(body.as, 80);
  const legacy = !row.booked_by_email && !!as && as === row.peer;   // made before bookings knew their account: the name it was made under
  if (!mayManage(row, viewer) && !legacy) return fail('Only the account that made this booking, or the Whips and above, can cancel it.', 403);
  const { scope, filter } = scopeFilter(row, body.scope);
  const ids = (await sbSelect(env, 'room_bookings', `select=id&${filter}`)).map((r) => r.id);
  await settleRequests(env, ids, 'released', 'The booking was cancelled, so the slot is free.');
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/room_bookings?${filter}`, { method: 'DELETE', headers: wHeaders(env, 'return=representation') });
  if (!res.ok) throw new Error(`Supabase room_bookings: ${res.status} ${await res.text()}`);
  const gone = await res.json();
  return json({ ok: true, cancelled: gone.length, scope });
}

/** Change one booking: its date, times, note, or whether it is set in stone. */
async function amend(env, body, viewer) {
  const id = posInt(body.id);
  if (!id) return fail('Unknown booking.');
  const row = await lookup(env, id);
  if (!row) return fail('That booking has already been cancelled.', 404);
  if (!mayManage(row, viewer)) return fail('Only the account that made this booking, or the Whips and above, can change it.', 403);
  const now = timesOf(row);
  const date = body.date === undefined ? now.date : body.date;
  const start = body.start === undefined ? now.start : String(body.start);
  const end = body.end === undefined ? now.end : String(body.end);
  if (!isIsoDate(date)) return fail('Choose a date.');
  if (!validTime(start) || !validTime(end, { end: true }) || toMinutes(end) <= toMinutes(start)) return fail('Choose a start and end time on the half hour, within the room\u2019s opening hours, with the end after the start.');
  const moved = date !== now.date || start !== now.start || end !== now.end;
  const today = londonToday();
  if (moved && (date < today || (date === today && toMinutes(start) < londonMinutesNow()))) return fail('That time has already passed.');
  if (moved && date > addDays(today, MAX_DAYS_AHEAD)) return fail(`The room can only be booked up to ${MAX_DAYS_AHEAD} days ahead.`);
  const patch = {};
  if (moved) { patch.start_at = `${date}T${start}:00`; patch.end_at = `${date}T${end}:00`; patch.series_id = null; }   // a moved date is no longer part of its repeat
  if (body.note !== undefined) patch.note = cleanLine(body.note, MAX_NOTE_LENGTH) || null;
  if (body.locked !== undefined) patch.locked = !!body.locked;
  if (!Object.keys(patch).length) return fail('Nothing to change.');
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/room_bookings?id=eq.${id}`, { method: 'PATCH', headers: wHeaders(env), body: JSON.stringify(patch) });
  if (!res.ok) {
    if (res.status === 409) return fail('That time is already booked.', 409);
    throw new Error(`Supabase room_bookings: ${res.status} ${await res.text()}`);
  }
  if (moved) await settleRequests(env, [id], 'released', 'The booking was moved, so this slot is free.');
  else if (patch.locked) await settleRequests(env, [id], 'cannot-move', 'The booking has been set in stone.');
  return json({ ok: true, moved });
}

/** Set a booking in stone (nobody can ask for it to be moved), or free it again. */
async function lock(env, body, viewer) {
  const id = posInt(body.id);
  if (!id) return fail('Unknown booking.');
  const row = await lookup(env, id);
  if (!row) return fail('That booking has already been cancelled.', 404);
  if (!mayManage(row, viewer)) return fail('Only the account that made this booking, or the Whips and above, can change it.', 403);
  const { scope, filter } = scopeFilter(row, body.scope);
  const locked = !!body.locked;
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/room_bookings?${filter}`, { method: 'PATCH', headers: wHeaders(env, 'return=representation'), body: JSON.stringify({ locked }) });
  if (!res.ok) throw new Error(`Supabase room_bookings: ${res.status} ${await res.text()}`);
  const changed = await res.json();
  if (locked) await settleRequests(env, changed.map((r) => r.id), 'cannot-move', 'The booking has been set in stone.');
  return json({ ok: true, changed: changed.length, locked, scope });
}

export async function onRequestPost({ request, env, data }) {
  const refused = await passcodeProblem(request, env);
  if (refused) return refused;
  let body;
  try { body = await request.json(); } catch { return fail('Send JSON.'); }
  if (!supabaseConfigured(env)) return fail('Supabase settings are missing in Cloudflare.', 503);
  try {
    const viewer = await withTeam(env, await viewerOf(request, env, data));
    if (body.action === 'book') return await book(env, body, viewer);
    if (body.action === 'cancel') return await cancel(env, body, viewer);
    if (body.action === 'amend') return await amend(env, body, viewer);
    if (body.action === 'lock') return await lock(env, body, viewer);
    return fail('Unknown action.');
  } catch (err) {
    if (missingTable(err)) return fail('The room booking tables have not been created yet: run schema.sql in Supabase.', 503);
    return errorResponse(err);
  }
}
