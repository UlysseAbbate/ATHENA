// Comments on amendments (these replace the old "suggested treatment" notes).
//   GET  /api/comments?bill=:billId&stage=:billStageId   → { comments: { [amendmentId]: [ { id, body, author, at } ] } }
//   POST /api/comments  { passcode, action: 'add',    billId, stageId, amendmentId, body, author }
//   POST /api/comments  { passcode, action: 'delete', id }
// Reading is open to anyone who can see the site; adding or deleting needs the editor passcode.

import { json, errorResponse } from '../../../lib/libby/util.js';
import { sbSelect, supabaseConfigured } from '../../../lib/libby/supabase.js';
import { passcodeProblem, cleanLine, cleanBlock } from '../../../lib/libby/auth.js';

const posInt = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : 0; };

const writeHeaders = (env, prefer) => ({
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  'content-type': 'application/json',
  prefer,
});

export async function onRequestGet({ request, env }) {
  const q = new URL(request.url).searchParams;
  const bill = posInt(q.get('bill'));
  const stage = posInt(q.get('stage'));
  if (!bill || !stage) return json({ error: 'Pass ?bill= and ?stage=.' }, { status: 400 });
  if (!supabaseConfigured(env)) return json({ error: 'Supabase settings are missing in Cloudflare.' }, { status: 503 });
  try {
    const rows = await sbSelect(env, 'amendment_comments',
      `select=id,amendment_id,body,author,created_at&bill_id=eq.${bill}&stage_id=eq.${stage}&order=created_at.asc`);
    const comments = {};
    for (const r of rows) (comments[r.amendment_id] ||= []).push({ id: r.id, body: r.body, author: r.author || '', at: r.created_at });
    return json({ comments });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Send JSON.' }, { status: 400 }); }
  const refused = await passcodeProblem(request, env);
  if (refused) return refused;
  if (!supabaseConfigured(env)) return json({ error: 'Supabase settings are missing in Cloudflare.' }, { status: 503 });

  try {
    if (body.action === 'delete') {
      const id = posInt(body.id);
      if (!id) return json({ error: 'Unknown comment.' }, { status: 400 });
      const res = await fetch(`${env.SUPABASE_URL}/rest/v1/amendment_comments?id=eq.${id}`, {
        method: 'DELETE', headers: writeHeaders(env, 'return=minimal'),
      });
      if (!res.ok) throw new Error(`Supabase amendment_comments: ${res.status} ${await res.text()}`);
      return json({ ok: true, id });
    }

    const billId = posInt(body.billId);
    const stageId = posInt(body.stageId);
    const amendmentId = posInt(body.amendmentId);
    const text = cleanBlock(body.body, 2000);
    if (!billId || !stageId || !amendmentId) return json({ error: 'Unknown amendment.' }, { status: 400 });
    if (!text) return json({ error: 'Type a comment first.' }, { status: 400 });

    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/amendment_comments`, {
      method: 'POST',
      headers: writeHeaders(env, 'return=representation'),
      body: JSON.stringify([{ bill_id: billId, stage_id: stageId, amendment_id: amendmentId, body: text, author: cleanLine(body.author, 80) || null }]),
    });
    if (!res.ok) throw new Error(`Supabase amendment_comments: ${res.status} ${await res.text()}`);
    const [row] = await res.json();
    return json({ ok: true, comment: { id: row.id, body: row.body, author: row.author || '', at: row.created_at } });
  } catch (err) {
    return errorResponse(err);
  }
}
