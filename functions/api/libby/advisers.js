// POST /api/advisers   { billId, adviser, editor }   -> saves the adviser for one Bill (Staff and Admin).
// Reading advisers is done by GET /api/bill-extras, which is the same information the Legislation page shows.

import { json, errorResponse } from '../../../lib/libby/util.js';
import { sbUpsert, supabaseConfigured } from '../../../lib/libby/supabase.js';
import { passcodeProblem, cleanLine } from '../../../lib/libby/auth.js';

export async function onRequestPost({ request, env }) {
  const refused = await passcodeProblem(request, env);
  if (refused) return refused;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Send JSON.' }, { status: 400 }); }
  if (body.action === 'verify') return json({ ok: true });

  const billId = Number(body.billId);
  if (!Number.isInteger(billId) || billId <= 0) return json({ error: 'Unknown Bill.' }, { status: 400 });
  if (!supabaseConfigured(env)) return json({ error: 'Supabase settings are missing in Cloudflare.' }, { status: 503 });

  const advisers = cleanLine(body.adviser, 200);
  const editor = cleanLine(body.editor, 80);
  try {
    await sbUpsert(env, 'bill_advisers', [{ bill_id: billId, advisers, updated_by: editor || null, updated_at: new Date().toISOString() }]);
    return json({ ok: true, billId, adviser: advisers });
  } catch (err) {
    return errorResponse(err);
  }
}
