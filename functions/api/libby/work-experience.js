// Work Experience Support: someone asks for a Peer to host work experience students at a date and time, and Peers say they can.
//   GET  /api/libby/work-experience?from=YYYY-MM-DD&to=YYYY-MM-DD  -> { requests: [ { id, requester, contact, date, start, end, students, note, offers: [ { id, peer, note } ] } ] }
//   POST { action: 'request', requester, contact?, date, start, end, students, note? }
//        { action: 'offer', requestId, peer, note? }          a Peer says they can host
//        { action: 'withdraw', offerId, as }                  take an offer back (the Peer who made it, or Staff)
//        { action: 'cancel', id, as }                          cancel a request (whoever made it, or Staff)
// Everyone signed in can see every request. Shared codes cannot prove who someone is, so the name is a record, as for the room bookings.
import { json, errorResponse, isIsoDate, londonToday, addDays } from '../../../lib/libby/util.js';
import { sbSelect, supabaseConfigured } from '../../../lib/libby/supabase.js';
import { passcodeProblem, cleanLine } from '../../../lib/libby/auth.js';
import { levelFromRequest, atLeast } from '../../../lib/libby/access.js';

const MAX_SPAN_DAYS = 120;
const fail = (message, status = 400) => json({ error: message }, { status });
const wHeaders = (env, prefer = 'return=minimal') => ({
  apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', prefer,
});
const time = (v) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v)) ? String(v) : '');
const posInt = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : 0; };
const missingTable = (err) => /work_experience/.test(String(err.message)) && /does not exist|relation|schema cache/.test(String(err.message));

export async function onRequestGet({ request, env }) {
  const q = new URL(request.url).searchParams;
  const from = isIsoDate(q.get('from')) ? q.get('from') : londonToday();
  let to = isIsoDate(q.get('to')) ? q.get('to') : addDays(from, 41);
  if (to < from) to = from;
  if (to > addDays(from, MAX_SPAN_DAYS - 1)) to = addDays(from, MAX_SPAN_DAYS - 1);
  if (!supabaseConfigured(env)) return fail('Supabase settings are missing in Cloudflare.', 503);
  try {
    const rows = await sbSelect(env, 'work_experience_requests', `select=id,requester,contact,day,start_time,end_time,students,note&day=gte.${from}&day=lte.${to}&order=day.asc,start_time.asc&limit=500`);
    const offers = rows.length ? await sbSelect(env, 'work_experience_offers', `select=id,request_id,peer,note&request_id=in.(${rows.map((r) => r.id).join(',')})&order=created_at.asc`) : [];
    return json({ from, to, requests: rows.map((r) => ({
      id: r.id, requester: r.requester, contact: r.contact || '', date: r.day, start: String(r.start_time).slice(0, 5), end: String(r.end_time).slice(0, 5), students: r.students, note: r.note || '',
      offers: offers.filter((o) => o.request_id === r.id).map((o) => ({ id: o.id, peer: o.peer, note: o.note || '' })),
    })) });
  } catch (err) {
    if (missingTable(err)) return fail('The work experience tables have not been created yet.', 503);
    return errorResponse(err);
  }
}

async function request_(env, body) {
  const requester = cleanLine(body.requester, 80);
  if (!requester) return fail('Say who is asking.');
  if (!isIsoDate(body.date)) return fail('Choose a date.');
  if (body.date < londonToday()) return fail('That date has already passed.');
  const start = time(body.start), end = time(body.end);
  if (!start || !end || end <= start) return fail('Choose a start and end time, with the end after the start.');
  const students = Math.min(50, posInt(body.students) || 1);
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/work_experience_requests`, { method: 'POST', headers: wHeaders(env, 'return=representation'),
    body: JSON.stringify([{ requester, contact: cleanLine(body.contact, 120) || null, day: body.date, start_time: start, end_time: end, students, note: cleanLine(body.note, 400) || null }]) });
  if (!res.ok) throw new Error(`Supabase work_experience_requests: ${res.status} ${await res.text()}`);
  return json({ ok: true, id: (await res.json())[0].id });
}

async function offer(env, body) {
  const requestId = posInt(body.requestId);
  const peer = cleanLine(body.peer, 80);
  if (!requestId) return fail('Unknown request.');
  if (!peer) return fail('Choose your name first.');
  const [row] = await sbSelect(env, 'work_experience_requests', `select=id&id=eq.${requestId}`);
  if (!row) return fail('That request has been cancelled.', 404);
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/work_experience_offers`, { method: 'POST', headers: wHeaders(env), body: JSON.stringify([{ request_id: requestId, peer, note: cleanLine(body.note, 300) || null }]) });
  if (!res.ok) throw new Error(`Supabase work_experience_offers: ${res.status} ${await res.text()}`);
  return json({ ok: true });
}

async function withdraw(env, body, isStaff) {
  const id = posInt(body.offerId);
  const [row] = id ? await sbSelect(env, 'work_experience_offers', `select=id,peer&id=eq.${id}`) : [];
  if (!row) return fail('That offer has already gone.', 404);
  if (!isStaff && cleanLine(body.as, 80) !== row.peer) return fail(`Only ${row.peer} or Staff can take this offer back.`, 403);
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/work_experience_offers?id=eq.${id}`, { method: 'DELETE', headers: wHeaders(env) });
  if (!res.ok) throw new Error(`Supabase work_experience_offers: ${res.status} ${await res.text()}`);
  return json({ ok: true });
}

async function cancel(env, body, isStaff) {
  const id = posInt(body.id);
  const [row] = id ? await sbSelect(env, 'work_experience_requests', `select=id,requester&id=eq.${id}`) : [];
  if (!row) return fail('That request has already been cancelled.', 404);
  if (!isStaff && cleanLine(body.as, 80) !== row.requester) return fail(`Only ${row.requester} or Staff can cancel this request.`, 403);
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/work_experience_requests?id=eq.${id}`, { method: 'DELETE', headers: wHeaders(env) });
  if (!res.ok) throw new Error(`Supabase work_experience_requests: ${res.status} ${await res.text()}`);
  return json({ ok: true });
}

export async function onRequestPost({ request, env }) {
  const refused = await passcodeProblem(request, env);
  if (refused) return refused;
  let body;
  try { body = await request.json(); } catch { return fail('Send JSON.'); }
  if (!supabaseConfigured(env)) return fail('Supabase settings are missing in Cloudflare.', 503);
  try {
    const staff = () => levelFromRequest(request, env).then((l) => atLeast(l, 'staff'));
    if (body.action === 'request') return await request_(env, body);
    if (body.action === 'offer') return await offer(env, body);
    if (body.action === 'withdraw') return await withdraw(env, body, await staff());
    if (body.action === 'cancel') return await cancel(env, body, await staff());
    return fail('Unknown action.');
  } catch (err) {
    if (missingTable(err)) return fail('The work experience tables have not been created yet.', 503);
    return errorResponse(err);
  }
}
