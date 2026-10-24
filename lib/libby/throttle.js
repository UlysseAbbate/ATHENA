// Slows down password guessing on /api/login. After MAX failed attempts from one address within WINDOW_MINUTES, sign-in from
// that address is refused until the window has passed. Failures are kept in the login_failures table as a keyed hash of the
// address, never the address itself, and are deleted after a day. If the database cannot be reached, sign-in is not blocked.

import { supabaseConfigured, sbSelect } from './supabase.js';

export const MAX = 10;
export const WINDOW_MINUTES = 15;

async function who(request, env) {
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
  const key = env.SESSION_SECRET || env.SUPABASE_SERVICE_ROLE_KEY || '';
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${key}|login|${ip}`)));
  return [...digest.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const rest = (env, path, init = {}) => fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
  ...init,
  headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', prefer: 'return=minimal' },
  signal: AbortSignal.timeout(5000),
});

/** True when this address has failed too often recently. */
export async function tooManyFailures(request, env) {
  if (!supabaseConfigured(env)) return false;
  try {
    const since = new Date(Date.now() - WINDOW_MINUTES * 60000).toISOString();
    const rows = await sbSelect(env, 'login_failures', `select=id&who=eq.${await who(request, env)}&at=gte.${encodeURIComponent(since)}&limit=${MAX}`);
    return rows.length >= MAX;
  } catch {
    return false;
  }
}

/** Notes a failed attempt (and clears out entries older than a day). Never throws. */
export async function recordFailure(request, env) {
  if (!supabaseConfigured(env)) return;
  try {
    await rest(env, 'login_failures', { method: 'POST', body: JSON.stringify({ who: await who(request, env) }) });
    const dayAgo = new Date(Date.now() - 864e5).toISOString();
    await rest(env, `login_failures?at=lt.${encodeURIComponent(dayAgo)}`, { method: 'DELETE' });
  } catch { /* the database being down must not stop anyone signing in */ }
}
