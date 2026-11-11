// Parliamentary process (Whips Hub): ask a question about procedure, answered from Erskine May and the Lords Companion (see lib/process-search.js).
//   GET  /api/libby/parliamentary-process  -> { questions: [ { id, question, house, askedBy, answer, sources, createdAt } ] (the latest 40), companion: { loaded, edition, pieces } }
//   POST { question, house? ('lords' | 'commons' | ''), asker? }  -> { id, answer, confidence, sources, queries, note }; the question and answer are kept on the list
//   POST { action: 'delete', id }   take a question off the list for good (Staff)
// Whips and above. The list is shared: everyone with access sees every question asked.
import { json, errorResponse, safe } from '../../../lib/libby/util.js';
import { sbSelect, supabaseConfigured } from '../../../lib/libby/supabase.js';
import { passcodeProblem, cleanLine, cleanBlock } from '../../../lib/libby/auth.js';
import { answerQuestion } from '../../../lib/libby/process-search.js';
import { levelFromRequest, atLeast } from '../../../lib/libby/access.js';

const fail = (message, status = 400) => json({ error: message }, { status });
const missingTable = (err) => /process_(questions|chunks)/.test(String(err.message)) && /does not exist|relation|schema cache/.test(String(err.message));

export async function onRequestGet({ env }) {
  if (!supabaseConfigured(env)) return fail('Supabase settings are missing in Cloudflare.', 503);
  try {
    const rows = await sbSelect(env, 'process_questions', 'select=id,question,house,asked_by,answer,sources,created_at&order=created_at.desc&limit=40');
    const first = await safe(sbSelect(env, 'process_chunks', "select=edition&source=eq.companion&limit=1"), []);
    const count = await safe(fetch(`${env.SUPABASE_URL}/rest/v1/process_chunks?select=id&source=eq.companion`, { method: 'HEAD', headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, prefer: 'count=exact' } }), null);
    const pieces = count ? Number((count.headers.get('content-range') || '').split('/')[1]) || 0 : 0;
    return json({ questions: rows.map((r) => ({ id: r.id, question: r.question, house: r.house, askedBy: r.asked_by || '', answer: r.answer, sources: r.sources || [], createdAt: r.created_at })),
      companion: { loaded: pieces > 0, edition: first[0] ? first[0].edition : '', pieces } });
  } catch (err) {
    if (missingTable(err)) return fail('The parliamentary process tables have not been created yet: run supabase/migrations/20261110600000_parliamentary_process.sql in Supabase.', 503);
    return errorResponse(err);
  }
}

export async function onRequestPost({ request, env }) {
  const refused = await passcodeProblem(request, env);
  if (refused) return refused;
  let body;
  try { body = await request.json(); } catch { return fail('Send JSON.'); }
  if (body.action === 'delete') {
    if (!atLeast(await levelFromRequest(request, env), 'staff')) return fail('Only Staff may delete a question.', 403);
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) return fail('Unknown question.');
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/process_questions?id=eq.${id}`, { method: 'DELETE', headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, prefer: 'return=minimal' } });
    if (!res.ok) return fail('The question could not be deleted.', 502);
    return json({ ok: true });
  }
  const question = cleanBlock(body.question, 1500);
  if (question.length < 8) return fail('Ask the question in a few words.');
  if (!env.ANTHROPIC_API_KEY) return fail('ANTHROPIC_API_KEY is not set in Cloudflare, so questions cannot be answered yet.', 503);
  const house = body.house === 'commons' ? 'commons' : body.house === 'lords' ? 'lords' : '';
  try {
    const out = await answerQuestion(env, { question, house });
    let id = null;
    if (supabaseConfigured(env)) {
      const res = await fetch(`${env.SUPABASE_URL}/rest/v1/process_questions`, {
        method: 'POST', headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', prefer: 'return=representation' },
        body: JSON.stringify([{ question, house, asked_by: cleanLine(body.asker, 80) || null, answer: out.answer, sources: out.sources.filter((s) => s.used).map(({ n, source, ref, title, where, url }) => ({ n, source, ref, title, where, url })) }]) });
      if (res.ok) id = ((await res.json())[0] || {}).id || null;
    }
    return json({ id, ...out });
  } catch (err) {
    return fail(`The question could not be answered (${err.message}).`, 502);
  }
}
