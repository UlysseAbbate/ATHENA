// GET /api/policy/documents — metadata for every stored motion / policy paper,
// used to list policy by portfolio under the search bar.

import { json, errorResponse } from '../../../../lib/libby/util.js';
import { sbSelect, supabaseConfigured } from '../../../../lib/libby/supabase.js';

export async function onRequestGet({ env }) {
  if (!supabaseConfigured(env)) return json({ error: 'The policy library is not connected yet (Supabase settings missing).' }, { status: 503 });
  try {
    const docs = await sbSelect(env, 'policy_documents',
      'select=id,title,doc_type,conference,date_label,date_passed,status,source_url,portfolios&order=date_passed.desc.nullslast&limit=2000');
    return json({ documents: docs }, { maxAge: 900 });
  } catch (err) {
    return errorResponse(err);
  }
}
