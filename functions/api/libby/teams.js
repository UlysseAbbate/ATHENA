// LIBBY teams: Staff bring people (staff or parliamentarians, by the email of their account) together so that they can share certain things.
// For now the one shared thing is seeing, in full, the Wallace Room and Room 391 bookings that other members of the team made (room-bookings.js).
// A team NEVER changes anyone's access level: membership is its own list, and what it shares is named in the code, never a level.
//   GET  /api/teams -> { teams: [ { id, name, members: [ { email, name, level } ] } ], people: [ { email, name, level } ] }   people = the accounts with LIBBY access, to pick from
//   POST { action: 'create', name }                  a new team
//   POST { action: 'rename', id, name }
//   POST { action: 'delete', id }                    removes the team (its members lose only what the team shared)
//   POST { action: 'add', id, email }                put an account in a team (any email: it takes effect when that account signs in)
//   POST { action: 'remove', id, email }
// Staff and above (see pages.js).
import { json, errorResponse, safe } from '../../../lib/libby/util.js';
import { sbSelect, supabaseConfigured } from '../../../lib/libby/supabase.js';
import { passcodeProblem, cleanLine } from '../../../lib/libby/auth.js';
import { LEVEL_NAMES } from '../../../lib/libby/access.js';

const MAX_TEAMS = 100, MAX_MEMBERS = 60;
const posInt = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : 0; };
const fail = (message, status = 400) => json({ error: message }, { status });
const wHeaders = (env, prefer = 'return=minimal') => ({ apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', prefer });
const missingTable = (err) => /libby_team/.test(String(err.message)) && /does not exist|relation|schema cache/.test(String(err.message));
const MISSING = 'The teams tables have not been created yet: run supabase/migrations/20261114100000_libby_teams.sql in Supabase.';
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** The accounts with LIBBY access: { email, name, level }. */
async function people(env) {
  const [grants, profiles] = await Promise.all([
    safe(sbSelect(env, 'access_grants', 'select=user_id,level&program=eq.libby&limit=2000'), []),
    safe(sbSelect(env, 'profiles', 'select=id,email,full_name&limit=3000'), []),
  ]);
  const byId = new Map(profiles.map((p) => [p.id, p]));
  return grants.map((g) => byId.get(g.user_id) && ({ email: String(byId.get(g.user_id).email || '').toLowerCase(), name: byId.get(g.user_id).full_name || '', level: LEVEL_NAMES[g.level] || g.level }))
    .filter((p) => p && p.email && !p.email.endsWith('@codes.invalid')).sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
}

export async function onRequestGet({ env }) {
  if (!supabaseConfigured(env)) return fail('Supabase settings are missing in Cloudflare.', 503);
  try {
    const [teams, members, accounts] = await Promise.all([
      sbSelect(env, 'libby_teams', 'select=id,name&order=name.asc&limit=200'),
      sbSelect(env, 'libby_team_members', 'select=team_id,email&order=added_at.asc&limit=5000'),
      people(env),
    ]);
    const known = new Map(accounts.map((p) => [p.email, p]));
    return json({
      teams: teams.map((t) => ({ id: t.id, name: t.name, members: members.filter((m) => m.team_id === t.id).map((m) => ({ email: m.email, name: (known.get(m.email) || {}).name || '', level: (known.get(m.email) || {}).level || '' })) })),
      people: accounts,
    }, { maxAge: 0 });
  } catch (err) {
    if (missingTable(err)) return fail(MISSING, 503);
    return errorResponse(err);
  }
}

export async function onRequestPost({ request, env, data }) {
  const refused = await passcodeProblem(request, env);
  if (refused) return refused;
  let body;
  try { body = await request.json(); } catch { return fail('Send JSON.'); }
  if (!supabaseConfigured(env)) return fail('Supabase settings are missing in Cloudflare.', 503);
  const by = (data && data.email) || null;
  const rest = `${env.SUPABASE_URL}/rest/v1`;
  const send = async (path, method, payload, prefer) => {
    const res = await fetch(`${rest}/${path}`, { method, headers: wHeaders(env, prefer), body: payload === undefined ? undefined : JSON.stringify(payload) });
    if (!res.ok) throw Object.assign(new Error(`Supabase ${path.split('?')[0]}: ${res.status} ${await res.text()}`), { status: res.status });
    return res;
  };
  try {
    if (body.action === 'create') {
      const name = cleanLine(body.name, 60);
      if (!name) return fail('Give the team a name.');
      const all = await sbSelect(env, 'libby_teams', 'select=id,name&limit=500');
      if (all.length >= MAX_TEAMS) return fail(`There are already ${MAX_TEAMS} teams.`);
      if (all.some((t) => t.name.toLowerCase() === name.toLowerCase())) return fail('There is already a team with that name.', 409);
      const res = await send('libby_teams', 'POST', [{ name, created_by: by }], 'return=representation');
      return json({ ok: true, id: (await res.json())[0].id });
    }
    const id = posInt(body.id);
    if (!id) return fail('Unknown team.');
    if (body.action === 'rename') {
      const name = cleanLine(body.name, 60);
      if (!name) return fail('Give the team a name.');
      await send(`libby_teams?id=eq.${id}`, 'PATCH', { name });
      return json({ ok: true });
    }
    if (body.action === 'delete') { await send(`libby_teams?id=eq.${id}`, 'DELETE'); return json({ ok: true }); }
    const email = cleanLine(body.email, 200).toLowerCase();
    if (body.action === 'add') {
      if (!EMAIL.test(email)) return fail('Give the person’s email address.');
      const have = await sbSelect(env, 'libby_team_members', `select=email&team_id=eq.${id}&limit=200`);
      if (have.some((m) => m.email === email)) return json({ ok: true, already: true });
      if (have.length >= MAX_MEMBERS) return fail(`A team can have ${MAX_MEMBERS} people.`);
      await send('libby_team_members', 'POST', [{ team_id: id, email, added_by: by }]);
      return json({ ok: true });
    }
    if (body.action === 'remove') { await send(`libby_team_members?team_id=eq.${id}&email=eq.${encodeURIComponent(email)}`, 'DELETE'); return json({ ok: true }); }
    return fail('Unknown action.');
  } catch (err) {
    if (missingTable(err)) return fail(MISSING, 503);
    if (err.status === 409) return fail('There is already a team with that name.', 409);
    return errorResponse(err);
  }
}
