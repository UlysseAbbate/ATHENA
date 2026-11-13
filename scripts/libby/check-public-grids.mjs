// Checks the public Groupings and grids page's server side (functions/api/grids/index.js): it is off without its key, refuses a wrong key, and gives public Parliament data to the right one.
// Run: node scripts/libby/check-public-grids.mjs
import { onRequestGet, keyProblem } from '../../functions/api/grids/index.js';

let failed = 0;
const ok = (cond, name) => { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}`); if (!cond) failed++; };

const realFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (url) => {
  const u = String(url); calls.push(u);
  if (u.includes('/Amendments/')) return new Response(JSON.stringify({ explanatoryText: 'Would lower the voting age.', amendmentLines: [] }), { status: 200 });
  return new Response('{}', { status: 404 });
};
const KEY = 'a-long-secret-key-123456';
const req = (qs, key) => new Request(`https://athena.test/api/grids?${qs}`, { headers: key === undefined ? {} : { 'x-grid-key': key } });
const run = async (qs, key, env = { GRID_LINK_KEY: KEY }) => onRequestGet({ request: req(qs, key), env, waitUntil() {} });

ok((await run('do=bills', KEY, {})).status === 503, 'without a GRID_LINK_KEY setting the page is switched off');
ok((await run('do=bills', KEY, { GRID_LINK_KEY: 'short' })).status === 503, 'a short key is not accepted as a setting');
ok((await run('do=bills')).status === 401 && (await run('do=bills', 'wrong-key-wrong-key-1')).status === 401, 'no key, or the wrong key, is refused');
ok(calls.length === 0, 'and nothing is asked of Parliament for them');
ok((await run('do=amendment&bill=1&stage=2', KEY)).status === 400 && (await run('do=nonsense', KEY)).status === 400 && (await run('do=stages&bill=abc', KEY)).status === 400, 'the right key still gets nothing for a malformed request');
const good = await run('do=amendment&bill=1&stage=2&aid=3', KEY);
const body = await good.json();
ok(good.status === 200 && body.explanatoryStatement === 'Would lower the voting age.' && good.headers.get('cache-control') === 'no-store', 'the right key gets one amendment’s text, never cached for others');
ok(await keyProblem(req('do=bills', KEY), { GRID_LINK_KEY: KEY }) === null, 'the right key passes');
globalThis.fetch = realFetch;

console.log(failed ? `\n${failed} check(s) failed` : '\nAll public grids checks passed.');
process.exit(failed ? 1 : 0);
