// POST /api/code-login  { code }  -> a signed-in Athena session for a shared access code.
// The code (made on the Access page) is checked in the database; everyone who uses one code signs in as that code's hidden
// account, which holds just the code's program and level. Switching the code off (or it ending) cuts them all off at once
// (the database checks the code is live whenever it looks up that account's level).
// Needs: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (and SESSION_SECRET for the guessing throttle). Wrong guesses are slowed
// down exactly like passwords (lib/libby/throttle.js).

import { json } from '../../lib/libby/util.js';
import { tooManyFailures, recordFailure, WINDOW_MINUTES } from '../../lib/libby/throttle.js';

const TIMEOUT = () => AbortSignal.timeout(8000);

async function rpc(env, fn, args) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', signal: TIMEOUT(),
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(args) });
  if (!res.ok) throw new Error(`${fn}: ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const admin = (env, path, body) => fetch(`${env.SUPABASE_URL}/auth/v1/${path}`, {
  method: 'POST', signal: TIMEOUT(),
  headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json' },
  body: JSON.stringify(body) });

export async function onRequestPost({ request, env }) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Access codes are not set up on this server.' }, { status: 503 });
  if (await tooManyFailures(request, env)) {
    return json({ error: `Too many wrong codes from this connection. Wait ${WINDOW_MINUTES} minutes, then try again.` }, { status: 429 });
  }
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Send JSON.' }, { status: 400 }); }
  const code = String(body?.code ?? '').trim();
  if (code.length < 8 || code.length > 200) {
    await Promise.all([recordFailure(request, env), new Promise((r) => setTimeout(r, 800))]);
    return json({ error: 'That code is not right.' }, { status: 401 });
  }
  try {
    const found = await rpc(env, 'redeem_access_code', { p_code: code });
    const row = Array.isArray(found) ? found[0] : found;
    if (!row?.id) {
      await Promise.all([recordFailure(request, env), new Promise((r) => setTimeout(r, 800))]);   // slows down anyone guessing
      return json({ error: 'That code is not right, or it has ended.' }, { status: 401 });
    }
    // the code's hidden account uses the code's own id, so creating it twice is harmless
    const email = `code-${row.id}@codes.invalid`;
    const made = await admin(env, 'admin/users', { id: row.id, email, email_confirm: true, user_metadata: { full_name: row.label } });
    if (!made.ok && made.status !== 422 && made.status !== 409) throw new Error(`create account: ${made.status}`);
    await rpc(env, 'link_code_identity', { p_code: row.id, p_user: row.id });
    const link = await admin(env, 'admin/generate_link', { type: 'magiclink', email });
    const hashed = (await link.json())?.hashed_token;
    if (!link.ok || !hashed) throw new Error(`sign-in link: ${link.status}`);
    const session = await admin(env, 'verify', { type: 'magiclink', token_hash: hashed });
    const s = await session.json();
    if (!session.ok || !s.access_token) throw new Error(`session: ${session.status}`);
    return json({ ok: true, access_token: s.access_token, refresh_token: s.refresh_token, expires_in: s.expires_in, label: row.label, program: row.program },
      { status: 200, maxAge: 0 });
  } catch (e) {
    return json({ error: 'Could not sign in with a code just now. Try again in a minute.' }, { status: 503 });
  }
}
