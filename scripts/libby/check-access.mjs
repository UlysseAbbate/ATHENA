// Checks sign-in (Athena session -> LIBBY level), the shared-code sign-in with its guessing throttle, and the security headers,
// without Cloudflare or a database (fetch is stubbed).   Run with:  node scripts/libby/check-access.mjs
import { onRequestPost as codeLogin } from '../../functions/api/code-login.js';
import { onRequestPost as claimCode } from '../../functions/api/claim-code.js';
import { onRequest as middleware } from '../../functions/api/libby/_middleware.js';
import { onRequestGet as me } from '../../functions/api/libby/me.js';
import { MAX } from '../../lib/libby/throttle.js';

let failed = 0;
const ok = (cond, name) => { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}`); if (!cond) failed++; };

// A fake Supabase: tokens map to people; levels map to people; one live shared code.
const TOKENS = { 'tok-peer': 'u-peer', 'tok-admin': 'u-admin', 'tok-none': 'u-none', 'tok-code': 'code-1', 'tok-beta': 'u-beta', 'tok-dev': 'u-dev' };
const LEVELS = { 'u-peer': 'peers', 'u-admin': 'admin', 'code-1': 'whips', 'u-beta': 'beta', 'u-dev': 'developer' };
const failures = [];
let levelCalls = 0, authDown = false, revoked = false;
const CODE = 'peers-basic-pass';
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url), json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  if (authDown && u.pathname.startsWith('/auth/v1/user')) throw new Error('down');
  if (u.pathname === '/auth/v1/user') {
    const t = (init.headers?.authorization || '').replace(/^Bearer /, '');
    return TOKENS[t] ? json({ id: TOKENS[t], email: `${TOKENS[t]}@test.invalid` }) : json({ message: 'bad jwt' }, 401);
  }
  if (u.pathname.endsWith('/rpc/level_of')) { levelCalls++; const b = JSON.parse(init.body); return json(revoked && b.p_user === 'code-1' ? null : LEVELS[b.p_user] ?? null); }
  if (u.pathname.endsWith('/rpc/redeem_access_code')) return json(JSON.parse(init.body).p_code === CODE ? [{ id: 'code-1', label: 'Peers', program: 'libby', level: 'whips' }] : []);
  if (u.pathname.endsWith('/rpc/claim_access_code')) { const b = JSON.parse(init.body); return json(b.p_code === 'test-beta-code-1' ? [{ program: 'libby', level: 'beta' }] : []); }
  if (u.pathname.endsWith('/rpc/link_code_identity')) return new Response(null, { status: 204 });
  if (u.pathname === '/auth/v1/admin/users') return json({ id: 'code-1' });
  if (u.pathname === '/auth/v1/admin/generate_link') return json({ hashed_token: 'h' });
  if (u.pathname === '/auth/v1/verify') return json({ access_token: 'tok-code', refresh_token: 'r', expires_in: 3600 });
  if (u.pathname.endsWith('/login_failures')) {
    if (init.method === 'POST') { failures.push({ who: JSON.parse(init.body).who }); return new Response(null, { status: 201 }); }
    if (init.method === 'DELETE') return new Response(null, { status: 204 });
    const who = u.searchParams.get('who').slice(3);
    return json(failures.filter((r) => r.who === who).map((r, i) => ({ id: i })));
  }
  return json([]);
};
const realTimeout = setTimeout;
globalThis.setTimeout = (fn) => realTimeout(fn, 0);   // skip the 0.8s pause on a wrong code in tests

const env = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'k', SESSION_SECRET: 's'.repeat(32) };
const ctx = (path, { token, method = 'GET', cookie } = {}) => ({ env, data: {},
  request: new Request(`https://athena.test${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(cookie ? { cookie } : {}) } }),
  next: async () => new Response('data', { headers: { 'cache-control': 'public, max-age=60' } }) });

// ---- the front door for /api/libby
let r = await middleware(ctx('/api/libby/status'));
ok(r.status === 401 && r.headers.get('strict-transport-security') && /noindex/.test(r.headers.get('x-robots-tag')), 'signed out: 401, with security headers');
r = await middleware(ctx('/api/libby/status', { token: 'forged' }));
ok(r.status === 401, 'a token Athena does not know is refused');
r = await middleware(ctx('/api/libby/status', { token: 'tok-none' }));
ok(r.status === 403 && (await r.json()).noAccess, 'signed in to Athena but given no LIBBY level: 403 "no access"');
r = await middleware(ctx('/api/libby/status', { token: 'tok-peer' }));
ok(r.status === 200 && /private/.test(r.headers.get('cache-control')) && r.headers.get('referrer-policy'), 'a Peer is let in; the reply is private with headers');
r = await middleware(ctx('/api/libby/status', { cookie: 'a=b; athena_at=tok-peer' }));
ok(r.status === 200, 'the session cookie (used by download links) works as well as the header');
r = await middleware(ctx('/api/libby/people-roles', { token: 'tok-peer', method: 'POST' }));
ok(r.status === 403, 'a Peer cannot change roles');
r = await middleware(ctx('/api/libby/people-roles', { token: 'tok-admin', method: 'POST' }));
ok(r.status === 200, 'the admin can');
const before = levelCalls;
await middleware(ctx('/api/libby/status', { token: 'tok-peer' })); await middleware(ctx('/api/libby/status', { token: 'tok-peer' }));
ok(levelCalls === before, 'the level is remembered for a few seconds, not looked up on every request');
authDown = true;
r = await middleware(ctx('/api/libby/status', { token: 'tok-new' }));
ok(r.status === 503, 'if sign-in cannot be reached the answer is "try again", not "sign in" (no reload loop)');
authDown = false;

// ---- /me
r = await me(ctx('/api/libby/me', { token: 'tok-admin' }));
const who = await r.json();
ok(r.status === 200 && who.level === 'admin' && who.email === 'u-admin@test.invalid', '/me says who and at what level');
r = await me(ctx('/api/libby/me', { token: 'tok-none' }));
ok(r.status === 403, '/me tells a person with no LIBBY level');

// ---- shared access codes
const post = (body, ip = '1.2.3.4') => ({ env, request: new Request('https://athena.test/api/code-login', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify(body) }) });
r = await codeLogin(post({ code: CODE }));
let d = await r.json();
ok(r.status === 200 && d.access_token === 'tok-code' && d.refresh_token, 'a right code gives a session');
r = await middleware(ctx('/api/libby/status', { token: d.access_token }));
ok(r.status === 200, 'the code session works in LIBBY at the code\'s level');
r = await middleware(ctx('/api/libby/people-roles', { token: d.access_token, method: 'POST' }));
ok(r.status === 403, '...and cannot do admin things');
r = await codeLogin(post({ code: 'not-the-code' }));
ok(r.status === 401, 'a wrong code is refused');
for (let i = 1; i < MAX; i++) await codeLogin(post({ code: 'wrong-wrong' }));
r = await codeLogin(post({ code: CODE }));
ok(r.status === 429, `after ${MAX} wrong codes the address is paused, even with the right code`);
r = await codeLogin(post({ code: CODE }, '5.6.7.8'));
ok(r.status === 200, 'another address is not affected');
ok(failures.every((x) => !x.who.includes('1.2.3.4') && /^[0-9a-f]{32}$/.test(x.who)), 'addresses are stored only as a keyed hash');
revoked = true;
r = await middleware(ctx('/api/libby/status', { token: 'tok-code-2' }));
ok(r.status === 401, 'an unknown token stays refused after a code is switched off');
levelCalls = 0;
// a fresh lookup for the code session after it is switched off: the database answers "no level", so the door closes
TOKENS['tok-code-fresh'] = 'code-1';
r = await middleware(ctx('/api/libby/status', { token: 'tok-code-fresh' }));
ok(r.status === 403, 'switching a code off closes the door for everyone using it');


// ---- the beta test and the Developer site
const beta = async (path, method = 'GET') => (await middleware(ctx(path, { token: 'tok-beta', method }))).status;
ok(await beta('/api/libby/data/votes') === 200 && await beta('/api/libby/data/lords') === 200 && await beta('/api/libby/status') === 200,
  'a Beta tester can read what is behind the Data page');
ok(await beta('/api/libby/comms') === 403 && await beta('/api/libby/policy/search') === 403 && await beta('/api/libby/portfolios') === 403, 'but no longer Comms or Policy');
ok(await beta('/api/libby/data/votes', 'POST') === 403 && await beta('/api/libby/room-bookings', 'POST') === 403, 'but not change anything');
ok(await beta('/api/libby/day/today') === 403 && await beta('/api/libby/bills') === 403 && await beta('/api/libby/future') === 403 && await beta('/api/libby/bulletin') === 403
  && await beta('/api/libby/room-bookings') === 403 && await beta('/api/libby/people-roles') === 403 && await beta('/api/libby/ld-peers') === 403, 'and nothing else, even though a Peer could read it');
r = await me(ctx('/api/libby/me', { token: 'tok-beta' }));
ok(r.status === 200 && (await r.json()).name === 'Beta tester', '/me tells a Beta tester their level');
r = await middleware(ctx('/api/libby/people-roles', { token: 'tok-dev', method: 'POST' }));
ok(r.status === 200, 'the Developer level can do everything the admin can');

// ---- claiming a shared code on a signed-in account (the beta code)
const claim = async (code, token = 'tok-none') => {
  const req = new Request('https://athena.test/api/claim-code', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
  return claimCode({ request: req, env });
};
r = await claimCode({ request: new Request('https://athena.test/api/claim-code', { method: 'POST', body: '{}' }), env });
ok(r.status === 401, 'claiming a code needs a sign-in');
r = await claim('test-beta-code-1');
ok(r.status === 200 && (await r.json()).level === 'beta', 'a signed-in person with the right code gets its level');
r = await claim('not-the-code');
ok(r.status === 401, 'a wrong code is refused');
r = await claim('short');
ok(r.status === 401, 'and so is one that is too short to be a code');

console.log(failed ? `\n${failed} check(s) failed` : '\nAll access checks passed.');
process.exit(failed ? 1 : 0);
