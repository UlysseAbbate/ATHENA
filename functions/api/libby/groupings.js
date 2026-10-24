// Saved groupings of amendments (one per Bill, stage and sitting day), entered on the adviser editor page.
//   GET  /api/groupings?bill=:billId[&stage=:billStageId]   → { groupings: [...] }
//   POST /api/groupings { passcode, action: 'save', billId, stageId, stageName, day, sittingDate, title, groups }
//   POST /api/groupings { passcode, action: 'delete', id }
import { json, errorResponse } from '../../../lib/libby/util.js';
import { sbSelect, supabaseConfigured } from '../../../lib/libby/supabase.js';
import { passcodeProblem, cleanLine } from '../../../lib/libby/auth.js';

const posInt = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : 0; };
const headers = (env, prefer) => ({ apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', prefer });
const KINDS = new Set(['number', 'clause', 'after', 'standpart']);

function cleanGroups(groups) {
  return (Array.isArray(groups) ? groups : []).slice(0, 80).map((g, i) => ({
    number: cleanLine(g?.number, 6).replace(/\D/g, '') || String(i + 1),
    topic: cleanLine(g?.topic, 200),
    refs: (Array.isArray(g?.refs) ? g.refs : []).slice(0, 250).map((r) => ({
      ref: cleanLine(r?.ref, 30), num: cleanLine(r?.num, 12), kind: KINDS.has(r?.kind) ? r.kind : 'number',
      part: r?.part === 'schedule' ? 'schedule' : 'clause', clause: cleanLine(r?.clause, 8), gov: !!r?.gov, debated: !!r?.debated,
    })).filter((r) => r.ref),
  })).filter((g) => g.refs.length);
}

export async function onRequestGet({ request, env }) {
  const q = new URL(request.url).searchParams;
  const bill = posInt(q.get('bill'));
  const stage = posInt(q.get('stage'));
  if (!bill) return json({ error: 'Pass ?bill=.' }, { status: 400 });
  if (!supabaseConfigured(env)) return json({ error: 'Supabase settings are missing in Cloudflare.' }, { status: 503 });
  try {
    const rows = await sbSelect(env, 'groupings',
      `select=id,bill_id,stage_id,stage_name,day,sitting_date,title,groups,themes,updated_by,updated_at&bill_id=eq.${bill}${stage ? `&stage_id=eq.${stage}` : ''}&order=stage_id.asc,day.asc`);
    return json({ groupings: rows });
  } catch (err) { return errorResponse(err); }
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
      if (!id) return json({ error: 'Unknown grouping.' }, { status: 400 });
      const res = await fetch(`${env.SUPABASE_URL}/rest/v1/groupings?id=eq.${id}`, { method: 'DELETE', headers: headers(env, 'return=minimal') });
      if (!res.ok) throw new Error(`Supabase groupings: ${res.status} ${await res.text()}`);
      return json({ ok: true, id });
    }
    const billId = posInt(body.billId);
    const stageId = posInt(body.stageId);
    const day = posInt(body.day);
    const groups = cleanGroups(body.groups);
    if (!billId || !stageId) return json({ error: 'Choose a Bill and a stage.' }, { status: 400 });
    if (!day) return json({ error: 'Give the sitting day number (1, 2, 3…).' }, { status: 400 });
    if (!groups.length) return json({ error: 'There are no groups to save.' }, { status: 400 });
    const date = /^\d{4}-\d{2}-\d{2}$/.test(body.sittingDate || '') ? body.sittingDate : null;
    const row = {
      bill_id: billId, stage_id: stageId, stage_name: cleanLine(body.stageName, 60), day, sitting_date: date,
      title: cleanLine(body.title, 200), groups, themes: null, updated_by: cleanLine(body.author, 80) || null, updated_at: new Date().toISOString(),
    };
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/groupings?on_conflict=bill_id,stage_id,day`, {
      method: 'POST', headers: headers(env, 'resolution=merge-duplicates,return=representation'), body: JSON.stringify([row]),
    });
    if (!res.ok) throw new Error(`Supabase groupings: ${res.status} ${await res.text()}`);
    const [saved] = await res.json();
    return json({ ok: true, grouping: saved });
  } catch (err) { return errorResponse(err); }
}
