// The Lords Companion for the Parliamentary process page: uploaded by the Whips' Office as a PDF (read in the browser, so only its text is sent), kept in pieces for searching.
//   POST { action: 'start', edition }                  forget the old copy and begin a new one (edition: e.g. "2022 edition, updated February 2024")
//   POST { action: 'add', edition, chunks: [ { ref, heading, page, body } ] }   add up to 300 pieces
// Staff (the Whips' Office features). Erskine May needs nothing: it is read live from its API.
import { json, errorResponse } from '../../../lib/libby/util.js';
import { supabaseConfigured } from '../../../lib/libby/supabase.js';
import { passcodeProblem, cleanLine, cleanBlock } from '../../../lib/libby/auth.js';

const fail = (message, status = 400) => json({ error: message }, { status });
const h = (env, prefer = 'return=minimal') => ({ apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', prefer });

export async function onRequestPost({ request, env }) {
  const refused = await passcodeProblem(request, env);
  if (refused) return refused;
  let body;
  try { body = await request.json(); } catch { return fail('Send JSON.'); }
  if (!supabaseConfigured(env)) return fail('Supabase settings are missing in Cloudflare.', 503);
  const edition = cleanLine(body.edition, 120);
  try {
    if (body.action === 'start') {
      const res = await fetch(`${env.SUPABASE_URL}/rest/v1/process_chunks?source=eq.companion`, { method: 'DELETE', headers: h(env) });
      if (!res.ok) throw new Error(`Supabase process_chunks: ${res.status} ${await res.text()}`);
      return json({ ok: true });
    }
    if (body.action === 'add') {
      const chunks = (Array.isArray(body.chunks) ? body.chunks : []).slice(0, 300).map((c) => ({
        source: 'companion', edition, ref: cleanLine(c.ref, 30), heading: cleanLine(c.heading, 200), page: Number.isInteger(c.page) ? c.page : null, body: cleanBlock(c.body, 4000),
      })).filter((c) => c.body.length >= 30);
      if (!chunks.length) return json({ ok: true, added: 0 });
      const res = await fetch(`${env.SUPABASE_URL}/rest/v1/process_chunks`, { method: 'POST', headers: h(env), body: JSON.stringify(chunks) });
      if (!res.ok) throw new Error(`Supabase process_chunks: ${res.status} ${await res.text()}`);
      return json({ ok: true, added: chunks.length });
    }
    return fail('Unknown action.');
  } catch (err) {
    return errorResponse(err);
  }
}
