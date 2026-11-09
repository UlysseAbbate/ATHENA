// Ask a Parliamentarian: anyone asks for help (attend an AGM, work experience support, speak at an event ...) by a date, and parliamentarians or their staff offer support.
//   GET  /api/libby/ask-parliamentarian[?past=1]  -> { requests: [ { id, requester, contact, kind, title, details, neededBy, eventDate, offers: [ { id, who, note } ] } ] }
//        Requests whose "needed by" date has not passed (with ?past=1, all of them), soonest first. Everyone signed in sees every request.
//   POST { action: 'request', requester, contact?, kind, title, details?, neededBy, eventDate? }
//        { action: 'offer', requestId, who, note? }      a parliamentarian or their staff offers support
//        { action: 'withdraw', offerId, as }             take an offer back (the person who made it, or Staff)
//        { action: 'cancel', id, as }                    cancel a request (whoever made it, or Staff)
// Shared codes cannot prove who someone is, so the names are a record, as for the room bookings.
import { json, errorResponse, isIsoDate, londonToday } from '../../../lib/libby/util.js';
import { sbSelect, supabaseConfigured } from '../../../lib/libby/supabase.js';
import { passcodeProblem, cleanLine, cleanBlock } from '../../../lib/libby/auth.js';
import { levelFromRequest, atLeast } from '../../../lib/libby/access.js';

const KINDS = ['agm', 'work-experience', 'event', 'visit', 'other'];
const fail = (message, status = 400) => json({ error: message }, { status });
const wHeaders = (env, prefer = 'return=minimal') => ({
  apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', prefer,
});
const posInt = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : 0; };
const missingTable = (err) => /ask_(requests|offers)/.test(String(err.message)) && /does not exist|relation|schema cache/.test(String(err.message));

export async function onRequestGet({ request, env }) {
  const past = new URL(request.url).searchParams.get('past') === '1';
  if (!supabaseConfigured(env)) return fail('Supabase settings are missing in Cloudflare.', 503);
  try {
    const rows = await sbSelect(env, 'ask_requests', `select=id,requester,contact,kind,title,details,needed_by,event_date${past ? '' : `&needed_by=gte.${londonToday()}`}&order=needed_by.asc,id.asc&limit=500`);
    const offers = rows.length ? await sbSelect(env, 'ask_offers', `select=id,request_id,who,note&request_id=in.(${rows.map((r) => r.id).join(',')})&order=created_at.asc`) : [];
    return json({ requests: rows.map((r) => ({
      id: r.id, requester: r.requester, contact: r.contact || '', kind: r.kind, title: r.title, details: r.details || '', neededBy: r.needed_by, eventDate: r.event_date || '',
      offers: offers.filter((o) => o.request_id === r.id).map((o) => ({ id: o.id, who: o.who, note: o.note || '' })),
    })) });
  } catch (err) {
    if (missingTable(err)) return fail('The Ask a Parliamentarian tables have not been created yet.', 503);
    return errorResponse(err);
  }
}

async function makeRequest(env, body) {
  const requester = cleanLine(body.requester, 80);
  const title = cleanLine(body.title, 140);
  if (!requester) return fail('Say who is asking.');
  if (!title) return fail('Say what you are asking for.');
  if (!isIsoDate(body.neededBy)) return fail('Say by when you need an answer.');
  if (body.neededBy < londonToday()) return fail('That date has already passed.');
  if (body.eventDate && !isIsoDate(body.eventDate)) return fail('The event date is not a date.');
  const kind = KINDS.includes(body.kind) ? body.kind : 'other';
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/ask_requests`, { method: 'POST', headers: wHeaders(env, 'return=representation'),
    body: JSON.stringify([{ requester, contact: cleanLine(body.contact, 120) || null, kind, title, details: cleanBlock(body.details, 1500) || null, needed_by: body.neededBy, event_date: body.eventDate || null }]) });
  if (!res.ok) throw new Error(`Supabase ask_requests: ${res.status} ${await res.text()}`);
  return json({ ok: true, id: (await res.json())[0].id });
}

async function makeOffer(env, body) {
  const requestId = posInt(body.requestId);
  const who = cleanLine(body.who, 100);
  if (!requestId) return fail('Unknown request.');
  if (!who) return fail('Say who is offering.');
  const [row] = await sbSelect(env, 'ask_requests', `select=id&id=eq.${requestId}`);
  if (!row) return fail('That request has been cancelled.', 404);
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/ask_offers`, { method: 'POST', headers: wHeaders(env), body: JSON.stringify([{ request_id: requestId, who, note: cleanLine(body.note, 400) || null }]) });
  if (!res.ok) throw new Error(`Supabase ask_offers: ${res.status} ${await res.text()}`);
  return json({ ok: true });
}

async function withdraw(env, body, isStaff) {
  const id = posInt(body.offerId);
  const [row] = id ? await sbSelect(env, 'ask_offers', `select=id,who&id=eq.${id}`) : [];
  if (!row) return fail('That offer has already gone.', 404);
  if (!isStaff && cleanLine(body.as, 100) !== row.who) return fail(`Only ${row.who} or Staff can take this offer back.`, 403);
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/ask_offers?id=eq.${id}`, { method: 'DELETE', headers: wHeaders(env) });
  if (!res.ok) throw new Error(`Supabase ask_offers: ${res.status} ${await res.text()}`);
  return json({ ok: true });
}

async function cancel(env, body, isStaff) {
  const id = posInt(body.id);
  const [row] = id ? await sbSelect(env, 'ask_requests', `select=id,requester&id=eq.${id}`) : [];
  if (!row) return fail('That request has already been cancelled.', 404);
  if (!isStaff && cleanLine(body.as, 80) !== row.requester) return fail(`Only ${row.requester} or Staff can cancel this request.`, 403);
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/ask_requests?id=eq.${id}`, { method: 'DELETE', headers: wHeaders(env) });
  if (!res.ok) throw new Error(`Supabase ask_requests: ${res.status} ${await res.text()}`);
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
    if (body.action === 'request') return await makeRequest(env, body);
    if (body.action === 'offer') return await makeOffer(env, body);
    if (body.action === 'withdraw') return await withdraw(env, body, await staff());
    if (body.action === 'cancel') return await cancel(env, body, await staff());
    return fail('Unknown action.');
  } catch (err) {
    if (missingTable(err)) return fail('The Ask a Parliamentarian tables have not been created yet.', 503);
    return errorResponse(err);
  }
}
