// GET /api/policy/search?q=...&portfolio=CODE
// Full-text search over Lib Dem conference motions and policy papers stored in Supabase.
// Returns the best-matching extract per document, with <mark> around matched words.

import { json, errorResponse } from '../../../../lib/libby/util.js';
import { sbRpc, supabaseConfigured } from '../../../../lib/libby/supabase.js';

export async function onRequestGet({ request, env }) {
  const params = new URL(request.url).searchParams;
  const q = (params.get('q') || '').trim().slice(0, 200);
  const portfolio = (params.get('portfolio') || '').toUpperCase() || null;
  if (!q) return json({ results: [] });
  if (!supabaseConfigured(env)) return json({ error: 'The policy library is not connected yet (Supabase settings missing).' }, { status: 503 });
  try {
    const results = await sbRpc(env, 'search_policy', { q, portfolio, max_results: 40 });
    return json({ q, results }, { maxAge: 300 });
  } catch (err) {
    return errorResponse(err);
  }
}
