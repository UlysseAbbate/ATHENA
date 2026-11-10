// The directory of who is a Whip, Spokesperson and so on. It decides who appears in the Whips pages (the duty rota and availability
// for whipping); it does not give anyone access (that is the role and password chosen at sign-in: lib/access.js).
//   GET  /api/people-roles  -> { roles: [ { id, label } ], people: [ { name, role, onList, house } ] }          (Whips and above)
//        `people` is every current Liberal Democrat peer, then every Lib Dem MP, on the Members list (role Peer / MP-as-"peers" unless one has been assigned;
//        `house` is 'lords' or 'commons'), then the people added by hand (`onList: false`, with the House they were added to), each with their role.
//   POST /api/people-roles  { action: 'set',    name, role }   change someone's role                          (Admin: back-channel)
//   POST /api/people-roles  { action: 'add',    name, role, house? }   add a person who is not on the Members list (Admin); house is 'lords' (default) or 'commons'
//   POST /api/people-roles  { action: 'remove', name }         remove a person added by hand                  (Admin)
// Only people whose role is not Peer, and people added by hand, are stored (table people_roles).

import { json, errorResponse, normPeer } from '../../../lib/libby/util.js';
import { sbSelect, supabaseConfigured } from '../../../lib/libby/supabase.js';
import { ldPeers, ldMPs } from '../../../lib/libby/parliament.js';
import { passcodeProblem, cleanLine } from '../../../lib/libby/auth.js';
import { ROLE_ORDER, LEVEL_NAMES } from '../../../lib/libby/access.js';

const DEFAULT_ROLE = 'peers';
const missingTable = (err) => /people_roles/.test(String(err.message)) && /does not exist|relation|schema cache/.test(String(err.message));
const MISSING = 'The people_roles table has not been created yet: run supabase/migrations/004_people-roles.sql in Supabase.';

/** "Baroness Brinton" sorts as "brinton", "Lord Purvis of Tweed" as "purvis of tweed"; an MP, "Sir Ed Davey", by the last word: "davey". */
const surnameKey = (n, house = 'lords') => (house === 'commons'
  ? String(n).trim().split(/\s+/).slice(-1)[0].toLowerCase()
  : String(n).replace(/^(The\s+)?(Lord|Baroness|Lady|Viscount|Earl|Countess|Marquess|Duke|Bishop)\s+/i, '').toLowerCase());
const bySurname = (a, b) => surnameKey(a.name, a.house).localeCompare(surnameKey(b.name, b.house)) || a.name.localeCompare(b.name);
const same = (a, b) => normPeer(a) === normPeer(b);

const roles = () => ROLE_ORDER.map((id) => ({ id, label: LEVEL_NAMES[id] }));
const writeHeaders = (env, prefer = 'return=minimal') => ({
  apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', prefer,
});

async function must(res, what) {
  if (!res.ok) throw new Error(`Supabase ${what}: ${res.status} ${await res.text()}`);
  return res;
}

/** The Members lists (names: the Lib Dem peers and the Lib Dem MPs) and the stored rows. `peers` here is everyone on either list. */
async function load(ctx) {
  const [lords, commons, rows] = await Promise.all([
    ldPeers(ctx).then((list) => list.map((p) => p.name).filter(Boolean)).catch(() => []),
    ldMPs(ctx).then((list) => list.map((p) => p.name).filter(Boolean)).catch(() => []),
    sbSelect(ctx.env, 'people_roles', 'select=name,role,house&order=name.asc'),
  ]);
  return { lords, commons, peers: [...lords, ...commons], rows };
}

export async function onRequestGet(ctx) {
  if (!supabaseConfigured(ctx.env)) return json({ error: 'Supabase settings are missing in Cloudflare.' }, { status: 503 });
  try {
    const { lords, commons, peers, rows } = await load(ctx);
    const stored = new Map(rows.map((r) => [r.name, r.role]));
    const listed = [...lords.map((name) => ({ name, house: 'lords' })), ...commons.map((name) => ({ name, house: 'commons' }))]
      .map((p) => ({ ...p, role: stored.get(p.name) || DEFAULT_ROLE, onList: true })).sort((a, b) => (a.house === b.house ? bySurname(a, b) : a.house === 'lords' ? -1 : 1));
    const onList = new Set(peers);
    const added = rows.filter((r) => !onList.has(r.name)).map((r) => ({ name: r.name, role: r.role, onList: false, house: r.house || 'lords' })).sort((a, b) => a.name.localeCompare(b.name));
    return json({ roles: roles(), people: [...listed, ...added] });
  } catch (err) {
    if (missingTable(err)) return json({ error: MISSING }, { status: 503 });
    return errorResponse(err);
  }
}

export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  const refused = await passcodeProblem(request, env);
  if (refused) return refused;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Send JSON.' }, { status: 400 }); }
  if (!supabaseConfigured(env)) return json({ error: 'Supabase settings are missing in Cloudflare.' }, { status: 503 });

  const action = body?.action;
  const name = cleanLine(body?.name, 80);
  const role = ROLE_ORDER.includes(body?.role) ? body.role : '';
  if (!name) return json({ error: 'Enter a name.' }, { status: 400 });
  if (action !== 'remove' && !role) return json({ error: 'Choose a role.' }, { status: 400 });
  const table = `${env.SUPABASE_URL}/rest/v1/people_roles`;
  const by = cleanLine(body?.author, 80) || null;

  try {
    const { peers, rows } = await load(ctx);
    const onList = peers.includes(name);
    const stored = rows.find((r) => r.name === name);

    if (action === 'set') {
      if (!onList && !stored) return json({ error: `${name} is not in the list.` }, { status: 404 });
      if (onList && role === DEFAULT_ROLE) { // back to the default: nothing to store
        await must(await fetch(`${table}?name=eq.${encodeURIComponent(name)}`, { method: 'DELETE', headers: writeHeaders(env) }), 'people_roles');
      } else {
        await must(await fetch(table, { method: 'POST', headers: writeHeaders(env, 'resolution=merge-duplicates,return=minimal'),
          body: JSON.stringify([{ name, role, updated_by: by, updated_at: new Date().toISOString() }]) }), 'people_roles');
      }
      return json({ ok: true, name, role });
    }

    if (action === 'add') {
      if (name.length < 2) return json({ error: 'Enter the full name.' }, { status: 400 });
      if (peers.some((p) => same(p, name)) || rows.some((r) => same(r.name, name))) return json({ error: `${name} is already in the list.` }, { status: 409 });
      const house = body?.house === 'commons' ? 'commons' : 'lords';
      await must(await fetch(table, { method: 'POST', headers: writeHeaders(env),
        body: JSON.stringify([{ name, role, house, updated_by: by, updated_at: new Date().toISOString() }]) }), 'people_roles');
      return json({ ok: true, name, role, house });
    }

    if (action === 'remove') {
      if (onList) return json({ error: `${name} is on the Members list, so they cannot be removed. Set their role to Peer instead.` }, { status: 400 });
      if (!stored) return json({ error: `${name} is not in the list.` }, { status: 404 });
      await must(await fetch(`${table}?name=eq.${encodeURIComponent(name)}`, { method: 'DELETE', headers: writeHeaders(env) }), 'people_roles');
      return json({ ok: true, name });
    }

    return json({ error: 'Unknown action.' }, { status: 400 });
  } catch (err) {
    if (missingTable(err)) return json({ error: MISSING }, { status: 503 });
    return errorResponse(err);
  }
}
