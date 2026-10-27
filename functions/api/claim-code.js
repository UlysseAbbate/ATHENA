// POST /api/claim-code  { code }   (signed in: Authorization: Bearer <the Athena session token>)
// A signed-in person types a shared access code (for example the LIBBY beta code). The code is checked in the database and its level is
// added to THEIR OWN account (never lowering a level they hold, never an admin-only level). Different from /api/code-login, which signs
// a person in as the code's hidden account. Wrong codes are slowed down exactly like passwords (lib/libby/throttle.js).

import { json } from '../../lib/libby/util.js';
import { identityFromRequest, forgetIdentity, AuthUnavailable } from '../../lib/libby/identity.js';
import { tooManyFailures, recordFailure, WINDOW_MINUTES } from '../../lib/libby/throttle.js';

async function rpc(env, fn, args) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', signal: AbortSignal.timeout(8000),
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(args) });
  if (!res.ok) throw new Error(`${fn}: ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export async function onRequestPost({ request, env }) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Access codes are not set up on this server.' }, { status: 503 });
  let who;
  try { who = await identityFromRequest(request, env); } catch (e) {
    if (e instanceof AuthUnavailable) return json({ error: 'The sign-in service cannot be reached. Try again in a minute.' }, { status: 503 });
    throw e;
  }
  if (!who) return json({ error: 'Please sign in first.' }, { status: 401 });
  if (await tooManyFailures(request, env)) {
    return json({ error: `Too many wrong codes from this connection. Wait ${WINDOW_MINUTES} minutes, then try again.` }, { status: 429 });
  }
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Send JSON.' }, { status: 400 }); }
  const code = String(body?.code ?? '').trim();
  const wrong = async () => {
    await Promise.all([recordFailure(request, env), new Promise((r) => setTimeout(r, 800))]);   // slows down anyone guessing
    return json({ error: 'That code is not right, or it has ended.' }, { status: 401 });
  };
  if (code.length < 8 || code.length > 200) return wrong();
  try {
    const found = await rpc(env, 'claim_access_code', { p_user: who.id, p_code: code });
    const row = Array.isArray(found) ? found[0] : found;
    if (!row?.program) return wrong();
    forgetIdentity(request);
    return json({ ok: true, program: row.program, level: row.level });
  } catch {
    return json({ error: 'Could not use the code just now. Try again in a minute.' }, { status: 503 });
  }
}
