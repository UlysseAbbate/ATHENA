// The Issues Tracker (Lib Dems 150): campaigns and long-standing issues, each in a portfolio, each with a running list of what has been done on it.
//   GET  /api/libby/issues[?portfolio=CODE]
//        -> { portfolios: [ { code, name, count } ], issues: [ { id, portfolio, title, description, status, createdBy, createdAt,
//             actions: [ { id, what, kind, date, url, parliamentarian, staff, notes, addedBy } ] } ] }   (actions oldest first)
//   POST { action: 'issue', portfolio, title, description?, author? }                      add a campaign or issue
//        { action: 'update-issue', id, title?, description?, status? ('open' | 'closed') } change one
//        { action: 'action', issueId, what, date, kind?, url?, parliamentarian?, staff?, notes?, author? }   add something that was done on it
//        { action: 'update-action', id, what?, date?, kind?, url?, parliamentarian?, staff?, notes? }
//        { action: 'delete-action', id } / { action: 'delete-issue', id }                    Whips and above (deleted for good, with an issue's actions)
// Everyone who can open the page may add and change; Whips and above may delete. Shared codes cannot prove who someone is, so the names are a record.
import { json, errorResponse, isIsoDate } from '../../../lib/libby/util.js';
import { sbSelect, supabaseConfigured } from '../../../lib/libby/supabase.js';
import { passcodeProblem, cleanLine, cleanBlock } from '../../../lib/libby/auth.js';
import { levelFromRequest, atLeast } from '../../../lib/libby/access.js';
import { PORTFOLIOS } from '../../../lib/libby/portfolios.js';

export const KINDS = ['oral-question', 'written-question', 'debate', 'legislation', 'amendment', 'committee', 'event', 'media', 'other'];
const fail = (message, status = 400) => json({ error: message }, { status });
const wHeaders = (env, prefer = 'return=minimal') => ({
  apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', prefer,
});
const posInt = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : 0; };
const missingTable = (err) => /issues|issue_actions/.test(String(err.message)) && /does not exist|relation|schema cache/.test(String(err.message));
const MISSING = 'The Issues Tracker tables have not been created yet: run supabase/migrations/20261110200000_issues_tracker.sql in Supabase.';
const cleanUrl = (u) => { const s = cleanLine(u, 500); return /^https?:\/\/\S+$/i.test(s) ? s : ''; };
const CODES = new Set(PORTFOLIOS.map((p) => p.code));

export async function onRequestGet({ request, env }) {
  if (!supabaseConfigured(env)) return fail('Supabase settings are missing in Cloudflare.', 503);
  const portfolio = (new URL(request.url).searchParams.get('portfolio') || '').toUpperCase();
  try {
    const all = await sbSelect(env, 'issues', `select=id,portfolio&limit=2000`);
    const counts = {};
    for (const r of all) counts[r.portfolio] = (counts[r.portfolio] || 0) + 1;
    const portfolios = PORTFOLIOS.map((p) => ({ code: p.code, name: p.name, count: counts[p.code] || 0 }));
    const rows = await sbSelect(env, 'issues', `select=*${CODES.has(portfolio) ? `&portfolio=eq.${portfolio}` : ''}&order=status.asc,updated_at.desc&limit=500`);
    const acts = rows.length ? await sbSelect(env, 'issue_actions', `select=*&issue_id=in.(${rows.map((r) => r.id).join(',')})&order=done_on.asc,id.asc&limit=5000`) : [];
    return json({ portfolios, issues: rows.map((r) => ({
      id: r.id, portfolio: r.portfolio, title: r.title, description: r.description || '', status: r.status, createdBy: r.created_by || '', createdAt: r.created_at,
      actions: acts.filter((a) => a.issue_id === r.id).map((a) => ({ id: a.id, what: a.what, kind: a.kind, date: a.done_on, url: a.url || '', parliamentarian: a.parliamentarian || '', staff: a.staff || '', notes: a.notes || '', addedBy: a.added_by || '' })),
    })) });
  } catch (err) {
    if (missingTable(err)) return fail(MISSING, 503);
    return errorResponse(err);
  }
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return fail('Send JSON.'); }
  const refused = await passcodeProblem(request, env);
  if (refused) return refused;
  if (!supabaseConfigured(env)) return fail('Supabase settings are missing in Cloudflare.', 503);
  const base = `${env.SUPABASE_URL}/rest/v1`;
  const author = cleanLine(body.author, 80) || null;
  const send = async (path, method, payload, prefer) => {
    const res = await fetch(`${base}/${path}`, { method, headers: wHeaders(env, prefer), body: payload ? JSON.stringify(payload) : undefined });
    if (!res.ok) throw new Error(`Supabase ${path.split('?')[0]}: ${res.status} ${await res.text()}`);
    return res;
  };
  try {
    switch (body.action) {
      case 'issue': {
        const portfolio = String(body.portfolio || '').toUpperCase();
        const title = cleanLine(body.title, 160);
        if (!CODES.has(portfolio)) return fail('Choose a portfolio.');
        if (!title) return fail('Give the campaign or issue a title.');
        const res = await send('issues', 'POST', [{ portfolio, title, description: cleanBlock(body.description, 2000), created_by: author }], 'return=representation');
        const [row] = await res.json();
        return json({ ok: true, id: row && row.id });
      }
      case 'update-issue': {
        const id = posInt(body.id);
        if (!id) return fail('Unknown issue.');
        const patch = { updated_at: new Date().toISOString() };
        if (body.title !== undefined) { patch.title = cleanLine(body.title, 160); if (!patch.title) return fail('The title cannot be empty.'); }
        if (body.description !== undefined) patch.description = cleanBlock(body.description, 2000);
        if (body.status !== undefined) { if (!['open', 'closed'].includes(body.status)) return fail('Status is open or closed.'); patch.status = body.status; }
        await send(`issues?id=eq.${id}`, 'PATCH', patch);
        return json({ ok: true });
      }
      case 'action': {
        const issueId = posInt(body.issueId);
        const what = cleanBlock(body.what, 600);
        const date = String(body.date || '');
        if (!issueId) return fail('Unknown issue.');
        if (!what) return fail('Say what was done.');
        if (!isIsoDate(date)) return fail('Give the date it was done.');
        const kind = KINDS.includes(body.kind) ? body.kind : 'other';
        const res = await send('issue_actions', 'POST', [{ issue_id: issueId, what, kind, done_on: date, url: cleanUrl(body.url) || null, parliamentarian: cleanLine(body.parliamentarian, 100) || null,
          staff: cleanLine(body.staff, 100) || null, notes: cleanBlock(body.notes, 2000), added_by: author }], 'return=representation');
        await send(`issues?id=eq.${issueId}`, 'PATCH', { updated_at: new Date().toISOString() });
        const [row] = await res.json();
        return json({ ok: true, id: row && row.id });
      }
      case 'update-action': {
        const id = posInt(body.id);
        if (!id) return fail('Unknown action.');
        const patch = {};
        if (body.what !== undefined) { patch.what = cleanBlock(body.what, 600); if (!patch.what) return fail('Say what was done.'); }
        if (body.date !== undefined) { if (!isIsoDate(String(body.date))) return fail('Give the date it was done.'); patch.done_on = body.date; }
        if (body.kind !== undefined) patch.kind = KINDS.includes(body.kind) ? body.kind : 'other';
        if (body.url !== undefined) patch.url = cleanUrl(body.url) || null;
        if (body.parliamentarian !== undefined) patch.parliamentarian = cleanLine(body.parliamentarian, 100) || null;
        if (body.staff !== undefined) patch.staff = cleanLine(body.staff, 100) || null;
        if (body.notes !== undefined) patch.notes = cleanBlock(body.notes, 2000);
        if (!Object.keys(patch).length) return fail('Nothing to change.');
        await send(`issue_actions?id=eq.${id}`, 'PATCH', patch);
        return json({ ok: true });
      }
      case 'delete-action':
      case 'delete-issue': {
        const level = await levelFromRequest(request, env);
        if (!atLeast(level, 'whips')) return fail('Only Whips and above may delete.', 403);
        const id = posInt(body.id);
        if (!id) return fail('Unknown item.');
        await send(`${body.action === 'delete-issue' ? 'issues' : 'issue_actions'}?id=eq.${id}`, 'DELETE');
        return json({ ok: true });
      }
      default:
        return fail('Unknown action.');
    }
  } catch (err) {
    if (missingTable(err)) return fail(MISSING, 503);
    return errorResponse(err);
  }
}
