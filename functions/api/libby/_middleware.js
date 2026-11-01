// The front door for LIBBY's server routes (/api/libby/*). Runs before every one of them.
// No valid Athena sign-in: 401. Signed in but no LIBBY access: 403. Otherwise the person's level is checked against
// site/libby/js/pages.js for this route (403 if too low).

import { identityFromRequest, AuthUnavailable } from '../../../lib/libby/identity.js';
import { RANK, requiredLevel, atLeast, betaMay, BETA, isRestricted, liveMay } from '../../../lib/libby/access.js';

const NO_STORE = { 'cache-control': 'no-store' };

// Sent with every response: no framing by other sites, no MIME sniffing, HTTPS only, not indexed, no camera/microphone/location.
const SECURITY = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'SAMEORIGIN',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'strict-transport-security': 'max-age=31536000',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'x-robots-tag': 'noindex, nofollow',
};
function secured(res) {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY)) if (!out.headers.has(k)) out.headers.set(k, v);
  return out;
}

const jsonReply = (data, status) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...NO_STORE } });

export async function onRequest(ctx) {
  return secured(await gate(ctx));
}

async function gate(ctx) {
  const { request, env } = ctx;
  const path = new URL(request.url).pathname;

  let who;
  try { who = await identityFromRequest(request, env); } catch (e) {
    if (e instanceof AuthUnavailable) return jsonReply({ error: 'The sign-in service cannot be reached. Try again in a minute.' }, 503);
    throw e;
  }
  if (!who) return jsonReply({ error: 'Please sign in.', login: true }, 401);
  if (path.endsWith('/api/libby/me')) return ctx.next();   // /me explains a missing level itself
  if (!RANK[who.level]) return jsonReply({ error: 'You have not been given access to LIBBY.', noAccess: true }, 403);

  // A beta tester may only read what is behind the beta pages; nothing else, whatever its usual level.
  if (who.level === BETA ? !betaMay(request.method, path) : !atLeast(who.level, requiredLevel(request.method, path))) {
    return jsonReply({ error: 'Your access level does not allow this.' }, 403);
  }
  // For now every level except Admin and Developer may only read what is behind the Data page (pages.js: LIVE_PAGES).
  if (isRestricted(who.level) && !liveMay(request.method, path)) return jsonReply({ error: 'Only the Data page is open for now.' }, 403);
  ctx.data.level = who.level;
  ctx.data.email = who.email;

  const res = await ctx.next();
  // Signed-in content must never be kept in a shared cache.
  const out = new Response(res.body, res);
  const cc = out.headers.get('cache-control');
  if (cc && /\bpublic\b/i.test(cc)) out.headers.set('cache-control', cc.replace(/\bpublic\b/i, 'private'));
  return out;
}
