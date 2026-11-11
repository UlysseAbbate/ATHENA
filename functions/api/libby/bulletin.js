// The Whips' Office Bulletin: the messages in the box on the home page. There are two, one for the Lords and one for the Commons.
//   GET  /api/bulletin[?house=commons]                      -> { house, messages: [ { id, heading, body, position, updated_by, updated_at } ] }   (everyone signed in; the Lords one unless house=commons)
//   POST /api/bulletin { action: 'save', id?, house?, heading, body, author }   add (no id; to the Lords or the Commons bulletin) or change a message   (Staff and Admin)
//   POST /api/bulletin { action: 'delete', id }
//   POST /api/bulletin { action: 'order', ids: [ ... ] }    put the messages in this order
// Messages stay until Staff or an Admin changes or deletes them.
import { json, errorResponse } from '../../../lib/libby/util.js';
import { sbSelect, supabaseConfigured } from '../../../lib/libby/supabase.js';
import { passcodeProblem, cleanLine, cleanBlock } from '../../../lib/libby/auth.js';

const MAX_MESSAGES = 12;
const posInt = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : 0; };
const headers = (env, prefer = 'return=minimal') => ({
  apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', prefer,
});
const missingTable = (err) => /bulletin_messages/.test(String(err.message)) && /does not exist|relation|schema cache/.test(String(err.message));
const houseOf = (v) => (v === 'commons' ? 'commons' : 'lords');
const list = (env, house = 'lords') => sbSelect(env, 'bulletin_messages', `select=id,heading,body,position,updated_by,updated_at&house=eq.${houseOf(house)}&order=position.asc,id.asc`);

export async function onRequestGet({ request, env }) {
  const house = houseOf(new URL(request.url).searchParams.get('house'));
  if (!supabaseConfigured(env)) return json({ house, messages: [] });
  try {
    return json({ house, messages: await list(env, house) });
  } catch (err) {
    if (missingTable(err)) return json({ messages: [], note: 'The bulletin_messages table has not been created yet: run add-bulletin.sql in Supabase.' });
    return errorResponse(err);
  }
}

export async function onRequestPost({ request, env }) {
  const refused = await passcodeProblem(request, env);
  if (refused) return refused;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Send JSON.' }, { status: 400 }); }
  if (!supabaseConfigured(env)) return json({ error: 'Supabase settings are missing in Cloudflare.' }, { status: 503 });

  try {
    if (body.action === 'delete') {
      const id = posInt(body.id);
      if (!id) return json({ error: 'Unknown message.' }, { status: 400 });
      const res = await fetch(`${env.SUPABASE_URL}/rest/v1/bulletin_messages?id=eq.${id}`, { method: 'DELETE', headers: headers(env) });
      if (!res.ok) throw new Error(`Supabase bulletin_messages: ${res.status} ${await res.text()}`);
      return json({ ok: true, id });
    }

    if (body.action === 'order') {
      const ids = (Array.isArray(body.ids) ? body.ids : []).map(posInt).filter(Boolean).slice(0, MAX_MESSAGES);
      for (let i = 0; i < ids.length; i++) {
        const res = await fetch(`${env.SUPABASE_URL}/rest/v1/bulletin_messages?id=eq.${ids[i]}`, { method: 'PATCH', headers: headers(env), body: JSON.stringify({ position: i + 1 }) });
        if (!res.ok) throw new Error(`Supabase bulletin_messages: ${res.status} ${await res.text()}`);
      }
      return json({ ok: true });
    }

    if (body.action === 'save') {
      const heading = cleanLine(body.heading, 120);
      const text = cleanBlock(body.body, 4000);
      if (!text) return json({ error: 'Type the message first.' }, { status: 400 });
      const fields = { heading: heading || null, body: text, updated_by: cleanLine(body.author, 80) || null, updated_at: new Date().toISOString() };
      const id = posInt(body.id);
      if (id) {
        const res = await fetch(`${env.SUPABASE_URL}/rest/v1/bulletin_messages?id=eq.${id}`, { method: 'PATCH', headers: headers(env), body: JSON.stringify(fields) });
        if (!res.ok) throw new Error(`Supabase bulletin_messages: ${res.status} ${await res.text()}`);
        return json({ ok: true, id });
      }
      const house = houseOf(body.house);
      const existing = await list(env, house);
      if (existing.length >= MAX_MESSAGES) return json({ error: `The bulletin can hold ${MAX_MESSAGES} messages. Delete one first.` }, { status: 400 });
      const position = existing.reduce((m, r) => Math.max(m, r.position || 0), 0) + 1;
      const res = await fetch(`${env.SUPABASE_URL}/rest/v1/bulletin_messages`, { method: 'POST', headers: headers(env, 'return=representation'), body: JSON.stringify([{ ...fields, house, position }]) });
      if (!res.ok) throw new Error(`Supabase bulletin_messages: ${res.status} ${await res.text()}`);
      const [row] = await res.json();
      return json({ ok: true, id: row.id });
    }
    return json({ error: 'Unknown action.' }, { status: 400 });
  } catch (err) {
    if (missingTable(err)) return json({ error: 'The bulletin_messages table has not been created yet: run add-bulletin.sql in Supabase.' }, { status: 503 });
    return errorResponse(err);
  }
}
