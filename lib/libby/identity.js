// Who is making this request, and at what LIBBY level. The person signs in once to Athena (Supabase Auth); the browser sends
// the session's access token as a cookie (athena_at, set by the page) or an Authorization header. Here it is checked with
// Supabase, and the person's level comes from the access_grants table (the database function level_of): so switching a
// person or a shared code off takes effect within CACHE_SECONDS, everywhere.

export const TOKEN_COOKIE = 'athena_at';
const CACHE_SECONDS = 30;
const CACHE = new Map();   // token -> { id, email, level, until }

export class AuthUnavailable extends Error {}

export function tokenFromRequest(request) {
  const h = request.headers.get('authorization') || '';
  if (/^bearer\s+\S+/i.test(h)) return h.replace(/^bearer\s+/i, '').trim();
  const raw = (request.headers.get('cookie') || '').split(/;\s*/).find((c) => c.startsWith(`${TOKEN_COOKIE}=`));
  return raw ? decodeURIComponent(raw.slice(TOKEN_COOKIE.length + 1)) : '';
}

const timeout = () => AbortSignal.timeout(6000);

/** { id, email, level } for the request's sign-in ('' level = signed in but no LIBBY access), or null if not signed in. Throws AuthUnavailable if Supabase cannot be reached. */
export async function identityFromRequest(request, env, program = 'libby') {
  const token = tokenFromRequest(request);
  if (!token || !env.SUPABASE_URL) return null;
  const key = `${program}|${token}`;
  const hit = CACHE.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  let user;
  try {
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${token}` }, signal: timeout() });
    if (res.status === 401 || res.status === 403) return null;
    if (!res.ok) throw new Error(`auth ${res.status}`);
    user = await res.json();
    if (!user?.id) return null;
    const lv = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/level_of`, {
      method: 'POST', signal: timeout(),
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p_user: user.id, p_program: program }) });
    if (!lv.ok) throw new Error(`level_of ${lv.status}`);
    const level = (await lv.json()) || '';
    const value = { id: user.id, email: user.email || '', level };
    if (CACHE.size > 500) CACHE.clear();
    CACHE.set(key, { value, until: Date.now() + CACHE_SECONDS * 1000 });
    return value;
  } catch (e) {
    throw new AuthUnavailable(e.message);
  }
}
