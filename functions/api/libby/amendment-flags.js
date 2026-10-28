// Buttons on amendments: Vote (orange), C = Content (green), NC = Not Content (red). Content and Not Content are the two positions, so setting
// one clears the other and also puts Voting on the amendment.
//   GET  /api/amendment-flags?bill=:billId&stage=:billStageId  -> { flags: { [amendmentId]: ['voting', 'content', ...] } }   (Whips and above)
//   POST /api/amendment-flags  { billId, stageId, amendmentId, flag, on, author }                                          (needs the Whips' Office features)
//     `on` true sets the flag, false clears it.

import { json, errorResponse } from '../../../lib/libby/util.js';
import { sbSelect, supabaseConfigured } from '../../../lib/libby/supabase.js';
import { passcodeProblem, cleanLine } from '../../../lib/libby/auth.js';

const FLAGS = ['voting', 'content', 'notcontent'];
const OPPOSITE = { content: 'notcontent', notcontent: 'content' };
const posInt = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : 0; };
const missingTable = (err) => /amendment_flags/.test(String(err.message)) && /does not exist|relation|schema cache/.test(String(err.message));
const MISSING = 'The amendment_flags table has not been created yet: run supabase/migrations/003_stakeholders-and-flags.sql in Supabase.';

const writeHeaders = (env, prefer) => ({
  apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', prefer,
});

export async function onRequestGet({ request, env }) {
  const q = new URL(request.url).searchParams;
  const bill = posInt(q.get('bill'));
  const stage = posInt(q.get('stage'));
  if (!bill || !stage) return json({ error: 'Pass ?bill= and ?stage=.' }, { status: 400 });
  if (!supabaseConfigured(env)) return json({ error: 'Supabase settings are missing in Cloudflare.' }, { status: 503 });
  try {
    const rows = await sbSelect(env, 'amendment_flags', `select=amendment_id,flag&bill_id=eq.${bill}&stage_id=eq.${stage}`);
    const flags = {};
    for (const r of rows) (flags[r.amendment_id] ||= []).push(r.flag);
    return json({ flags });
  } catch (err) {
    if (missingTable(err)) return json({ error: MISSING }, { status: 503 });
    return errorResponse(err);
  }
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Send JSON.' }, { status: 400 }); }
  const refused = await passcodeProblem(request, env);
  if (refused) return refused;
  if (!supabaseConfigured(env)) return json({ error: 'Supabase settings are missing in Cloudflare.' }, { status: 503 });

  const billId = posInt(body.billId);
  const stageId = posInt(body.stageId);
  const amendmentId = posInt(body.amendmentId);
  if (!billId || !stageId || !amendmentId) return json({ error: 'Unknown amendment.' }, { status: 400 });
  if (!FLAGS.includes(body.flag)) return json({ error: 'Unknown flag.' }, { status: 400 });

  try {
    const base = `${env.SUPABASE_URL}/rest/v1/amendment_flags`;
    const res = body.on
      ? await fetch(base, {
        method: 'POST', headers: writeHeaders(env, 'resolution=merge-duplicates,return=minimal'),
        body: JSON.stringify([{ bill_id: billId, stage_id: stageId, amendment_id: amendmentId, flag: body.flag, set_by: cleanLine(body.author, 80) || null, set_at: new Date().toISOString() }]),
      })
      : await fetch(`${base}?bill_id=eq.${billId}&stage_id=eq.${stageId}&amendment_id=eq.${amendmentId}&flag=eq.${body.flag}`, {
        method: 'DELETE', headers: writeHeaders(env, 'return=minimal'),
      });
    if (!res.ok) throw new Error(`Supabase amendment_flags: ${res.status} ${await res.text()}`);
    if (body.on && OPPOSITE[body.flag]) {   // a position (Content or Not Content) is also a Voting amendment...
      const vote = await fetch(base, {
        method: 'POST', headers: writeHeaders(env, 'resolution=merge-duplicates,return=minimal'),
        body: JSON.stringify([{ bill_id: billId, stage_id: stageId, amendment_id: amendmentId, flag: 'voting', set_by: cleanLine(body.author, 80) || null, set_at: new Date().toISOString() }]),
      });
      if (!vote.ok) throw new Error(`Supabase amendment_flags: ${vote.status} ${await vote.text()}`);
      // ...and the other position is cleared
      const clear = await fetch(`${base}?bill_id=eq.${billId}&stage_id=eq.${stageId}&amendment_id=eq.${amendmentId}&flag=eq.${OPPOSITE[body.flag]}`, { method: 'DELETE', headers: writeHeaders(env, 'return=minimal') });
      if (!clear.ok) throw new Error(`Supabase amendment_flags: ${clear.status} ${await clear.text()}`);
    }
    return json({ ok: true, flag: body.flag, on: !!body.on });
  } catch (err) {
    if (missingTable(err)) return json({ error: MISSING }, { status: 503 });
    return errorResponse(err);
  }
}
