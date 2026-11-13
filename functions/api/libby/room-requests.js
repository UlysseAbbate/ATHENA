// Requests for a booked room slot (the Wallace Room and Room 391). Someone below the Whips sees a booking only as "Booked"; they can ask for it, with a message,
// and the current booker (and the Whips and above) is told on the room pages and can say they will move it or cannot.
//   GET  /api/room-requests
//        -> { incoming: [ { id, room, date, start, end, requester, message, createdAt, booker, mine } ]   open requests on bookings this account holds (the Whips and above see every open request)
//             outgoing: [ { id, room, date, start, end, message, status, response, createdAt, respondedAt } ] this account's own requests (the last 30 days)
//             pending: number }                                                                            how many incoming are waiting
//   POST { action: 'request', bookingId, message, as? }   ask for a booked slot (refused if it is set in stone, past, or the booker's own)
//   POST { action: 'respond', id, response: 'will-move' | 'cannot-move', reply? }   the booker (or the Whips and above) answers
//   POST { action: 'withdraw', id }                        the requester takes the request back
// Needs the Peers' level (see pages.js). The booker's name is shown to the Whips and above only.
import { json, errorResponse, safe, londonToday, addDays } from '../../../lib/libby/util.js';
import { sbSelect, supabaseConfigured } from '../../../lib/libby/supabase.js';
import { passcodeProblem, cleanLine, cleanBlock } from '../../../lib/libby/auth.js';
import { atLeast } from '../../../lib/libby/access.js';
import { identityFromRequest } from '../../../lib/libby/identity.js';

const posInt = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : 0; };
const fail = (message, status = 400) => json({ error: message }, { status });
const wHeaders = (env, prefer = 'return=minimal') => ({ apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', prefer });
const missingTable = (err) => /room_requests/.test(String(err.message)) && /does not exist|relation|schema cache/.test(String(err.message));
const MISSING = 'The room request table has not been created yet: run supabase/migrations/20261113100000_room_privacy.sql in Supabase.';
const MAX_OPEN_PER_PERSON = 10;
export const MAX_MESSAGE = 500;

async function viewerOf(request, env, data) {
  if (data && data.level !== undefined) return { level: data.level, email: data.email || '' };
  try { const who = await identityFromRequest(request, env); return { level: (who && who.level) || '', email: (who && who.email) || '' }; } catch { return { level: '', email: '' }; }
}

export async function onRequestGet({ request, env, data }) {
  if (!supabaseConfigured(env)) return fail('Supabase settings are missing in Cloudflare.', 503);
  const viewer = await viewerOf(request, env, data);
  const whips = atLeast(viewer.level, 'whips');
  const me = encodeURIComponent(viewer.email || '-');
  try {
    const today = londonToday();
    const [incoming, outgoing] = await Promise.all([
      sbSelect(env, 'room_requests', `select=*&status=eq.open&booking_date=gte.${today}${whips ? '' : `&booker_email=eq.${me}`}&order=booking_date.asc,start_hm.asc&limit=100`),
      viewer.email ? sbSelect(env, 'room_requests', `select=*&requester_email=eq.${me}&created_at=gte.${addDays(today, -30)}T00:00:00&order=created_at.desc&limit=50`) : [],
    ]);
    return json({
      incoming: incoming.map((r) => ({ id: r.id, room: r.room, date: r.booking_date, start: r.start_hm, end: r.end_hm, requester: r.requester_name || 'Someone', message: r.message, createdAt: r.created_at,
        booker: whips ? (r.booker_name || '') : '', mine: !!viewer.email && r.booker_email === viewer.email })),
      outgoing: outgoing.map((r) => ({ id: r.id, room: r.room, date: r.booking_date, start: r.start_hm, end: r.end_hm, message: r.message, status: r.status, response: r.response || '', createdAt: r.created_at, respondedAt: r.responded_at })),
      pending: incoming.length,
    }, { maxAge: 0 });
  } catch (err) {
    if (missingTable(err)) return fail(MISSING, 503);
    return errorResponse(err);
  }
}

export async function onRequestPost({ request, env, data }) {
  const refused = await passcodeProblem(request, env);
  if (refused) return refused;
  let body;
  try { body = await request.json(); } catch { return fail('Send JSON.'); }
  if (!supabaseConfigured(env)) return fail('Supabase settings are missing in Cloudflare.', 503);
  const viewer = await viewerOf(request, env, data);
  if (!viewer.email) return fail('Please sign in.', 401);
  const table = `${env.SUPABASE_URL}/rest/v1/room_requests`;
  try {
    if (body.action === 'request') {
      const bookingId = posInt(body.bookingId);
      const message = cleanBlock(body.message, MAX_MESSAGE);
      if (!bookingId) return fail('Unknown booking.');
      if (message.length < 3) return fail('Say why you need the room: a short message helps the booker decide.');
      const [b] = await sbSelect(env, 'room_bookings', `select=id,room,peer,start_at,end_at,booked_by_email,locked&id=eq.${bookingId}`);
      if (!b) return fail('That booking no longer exists, so the slot may be free: reload the page.', 404);
      const date = b.start_at.slice(0, 10);
      if (b.locked) return fail('This booking has been set in stone, so it cannot be requested.', 409);
      if (date < londonToday()) return fail('That booking has already passed.', 409);
      if (b.booked_by_email && b.booked_by_email === viewer.email) return fail('This is your own booking: you can change it yourself.', 400);
      const mine = await sbSelect(env, 'room_requests', `select=id,booking_id&requester_email=eq.${encodeURIComponent(viewer.email)}&status=eq.open`);
      if (mine.some((r) => r.booking_id === bookingId)) return fail('You have already asked for this slot. The booker will answer on the room page.', 409);
      if (mine.length >= MAX_OPEN_PER_PERSON) return fail(`You already have ${MAX_OPEN_PER_PERSON} requests waiting: withdraw one first.`, 429);
      const row = { booking_id: bookingId, room: b.room, booking_date: date, start_hm: b.start_at.slice(11, 16), end_hm: b.end_at.slice(11, 16), booker_email: b.booked_by_email || null, booker_name: b.peer,
        requester_email: viewer.email, requester_name: cleanLine(body.as, 80) || viewer.email.split('@')[0], message };
      const res = await fetch(table, { method: 'POST', headers: wHeaders(env, 'return=representation'), body: JSON.stringify([row]) });
      if (!res.ok) throw new Error(`Supabase room_requests: ${res.status} ${await res.text()}`);
      return json({ ok: true, id: (await res.json())[0].id });
    }
    const id = posInt(body.id);
    if (!id) return fail('Unknown request.');
    const [r] = await sbSelect(env, 'room_requests', `select=*&id=eq.${id}`);
    if (!r) return fail('That request no longer exists.', 404);
    if (body.action === 'respond') {
      const whips = atLeast(viewer.level, 'whips');
      if (!(whips || (r.booker_email && r.booker_email === viewer.email))) return fail('Only the booker, or the Whips and above, can answer this request.', 403);
      if (r.status !== 'open') return fail('This request has already been dealt with.', 409);
      if (!['will-move', 'cannot-move'].includes(body.response)) return fail('Say whether you can move it.');
      const res = await fetch(`${table}?id=eq.${id}`, { method: 'PATCH', headers: wHeaders(env), body: JSON.stringify({ status: body.response, response: cleanLine(body.reply, 300) || null, responded_at: new Date().toISOString() }) });
      if (!res.ok) throw new Error(`Supabase room_requests: ${res.status} ${await res.text()}`);
      return json({ ok: true });
    }
    if (body.action === 'withdraw') {
      if (r.requester_email !== viewer.email) return fail('Only the person who asked can withdraw a request.', 403);
      const res = await fetch(`${table}?id=eq.${id}&status=eq.open`, { method: 'PATCH', headers: wHeaders(env), body: JSON.stringify({ status: 'withdrawn', responded_at: new Date().toISOString() }) });
      if (!res.ok) throw new Error(`Supabase room_requests: ${res.status} ${await res.text()}`);
      return json({ ok: true });
    }
    return fail('Unknown action.');
  } catch (err) {
    if (missingTable(err)) return fail(MISSING, 503);
    return errorResponse(err);
  }
}
