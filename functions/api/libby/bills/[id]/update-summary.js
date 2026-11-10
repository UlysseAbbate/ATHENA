// POST /api/libby/bills/:id/update-summary  { title, longTitle, official, parts, sources: [ { label, fileUrl } ] }
//   -> { overview: '...', parts: [ { heading, summary } ] }
// Claude writes the "what the Bill does" paragraph and a high-level summary of the Parts, from the official documents only (the Bill's own summary and, when there is one, the
// explanatory notes PDF, which Anthropic reads from its public address). It is told not to add anything the documents do not say. Whips' Office features (Staff).
import { json } from '../../../../../lib/libby/util.js';
import { passcodeProblem } from '../../../../../lib/libby/auth.js';
import { summariseBill } from '../../../../../lib/libby/claude.js';

export async function onRequestPost({ request, env }) {
  const refused = await passcodeProblem(request, env);
  if (refused) return refused;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Send JSON.' }, { status: 400 }); }
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'ANTHROPIC_API_KEY is not set in Cloudflare, so the summary is left to the official wording.' }, { status: 503 });
  try {
    return json(await summariseBill(env, body), { maxAge: 0 });
  } catch (err) {
    return json({ error: `The summary could not be written (${err.message}).` }, { status: 502 });
  }
}
