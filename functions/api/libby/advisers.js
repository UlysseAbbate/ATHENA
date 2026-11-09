// POST /api/advisers   { billId, editor, adviser?, lordsLead?, commonsAdviser?, commonsLead? }
//   saves a Bill's team (Staff and Admin): the Lords adviser (`adviser`), the Lords Bill lead, the Commons adviser and the Commons Bill lead.
//   Only the fields sent are changed. Reading is done by GET /api/bill-team?bill=ID (one Bill) and GET /api/bill-extras (every Bill).

import { json, errorResponse } from '../../../lib/libby/util.js';
import { sbUpsert, supabaseConfigured } from '../../../lib/libby/supabase.js';
import { passcodeProblem, cleanLine } from '../../../lib/libby/auth.js';

// the request's field -> the column it is saved in
const FIELDS = { adviser: 'advisers', lordsLead: 'lords_lead', commonsAdviser: 'commons_adviser', commonsLead: 'commons_lead' };

export async function onRequestPost({ request, env }) {
  const refused = await passcodeProblem(request, env);
  if (refused) return refused;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Send JSON.' }, { status: 400 }); }
  if (body.action === 'verify') return json({ ok: true });

  const billId = Number(body.billId);
  if (!Number.isInteger(billId) || billId <= 0) return json({ error: 'Unknown Bill.' }, { status: 400 });
  if (!supabaseConfigured(env)) return json({ error: 'Supabase settings are missing in Cloudflare.' }, { status: 503 });

  const row = { bill_id: billId, updated_by: cleanLine(body.editor, 80) || null, updated_at: new Date().toISOString() };
  const saved = {};
  for (const [field, column] of Object.entries(FIELDS)) {
    if (body[field] === undefined) continue;
    row[column] = cleanLine(body[field], 200);
    saved[field] = row[column];
  }
  if (!Object.keys(saved).length) return json({ error: 'Nothing to save.' }, { status: 400 });
  try {
    await sbUpsert(env, 'bill_advisers', [row]);
    return json({ ok: true, billId, ...saved });
  } catch (err) {
    return errorResponse(err);
  }
}
