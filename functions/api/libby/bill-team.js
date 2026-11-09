// GET /api/libby/bill-team?bill=ID  ->  { billId, lords: { adviser, lead }, commons: { adviser, lead } }
// Who is looking after one Bill in each House: the adviser and the Bill lead. Typed in on the adviser editor (POLD Staff); a blank means nobody has been named yet.
import { json, errorResponse } from '../../../lib/libby/util.js';
import { sbSelect, supabaseConfigured } from '../../../lib/libby/supabase.js';

export async function onRequestGet({ request, env }) {
  const id = Number(new URL(request.url).searchParams.get('bill'));
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'Unknown Bill.' }, { status: 400 });
  const empty = { billId: id, lords: { adviser: '', lead: '' }, commons: { adviser: '', lead: '' } };
  if (!supabaseConfigured(env)) return json(empty, { maxAge: 0 });
  try {
    const [r] = await sbSelect(env, 'bill_advisers', `select=advisers,lords_lead,commons_adviser,commons_lead&bill_id=eq.${id}`);
    if (!r) return json(empty, { maxAge: 0 });
    return json({ billId: id, lords: { adviser: r.advisers || '', lead: r.lords_lead || '' }, commons: { adviser: r.commons_adviser || '', lead: r.commons_lead || '' } }, { maxAge: 0 });
  } catch (err) {
    return errorResponse(err);
  }
}
