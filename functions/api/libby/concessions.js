// The Concessionometer (Lib Dems 150): every amendment marked WIN, kept whether or not its Bill is still live.
//   GET  /api/libby/concessions
//        -> { portfolios: [ { code, name } ], concessions: [ { billId, stageId, amendmentId, house, number, place, summary, url, billTitle, portfolio: ['HO', ...], notes, wonBy, wonAt, updatedBy, updatedAt } ] }, newest first
//   POST { action: 'win', on, billId, stageId, amendmentId, house, number?, place?, summary?, author? }
//        on: true marks the amendment WIN (the WIN button) and adds it here, with a snapshot of its Bill's title and portfolio; false takes it off again.
//   POST { action: 'edit', billId, stageId, amendmentId, notes?, billTitle?, wonAt? ('YYYY-MM-DD'), author? }   the POLD Staff's notes about the concession, and the Bill's name and date won, corrected by hand
//   POST { action: 'remove', billId, stageId, amendmentId }   take a concession off (the only way for one added by hand; a WIN one is also unmarked)
//   POST { action: 'add', billTitle, name?, portfolio? (codes), notes?, wonAt? ('YYYY-MM-DD'), period?, author? }   a concession not tied to an amendment (typed in, or imported from a spreadsheet)
//   POST { action: 'remove', billId, stageId, amendmentId }   take a concession off (the way for one added by hand; a WIN one is unmarked too)
//   POST { action: 'note', billId, stageId, amendmentId, notes, author? }   (notes only; kept for older callers)
// Reading: everyone signed in. Changing: the Whips' Office features (Staff), as for the other amendment buttons.
import { json, errorResponse, safe, pick } from '../../../lib/libby/util.js';
import { sbSelect, supabaseConfigured } from '../../../lib/libby/supabase.js';
import { passcodeProblem, cleanLine, cleanBlock } from '../../../lib/libby/auth.js';
import { bill as billById, activeBillsTagged } from '../../../lib/libby/parliament.js';
import { PORTFOLIOS } from '../../../lib/libby/portfolios.js';
import { tagBill } from '../../../lib/libby/bill-tags.js';

const posInt = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : 0; };
const fail = (message, status = 400) => json({ error: message }, { status });
const missingTable = (err) => /concessions/.test(String(err.message)) && /does not exist|relation|schema cache/.test(String(err.message));
const MISSING = 'The concessions table has not been created yet: run supabase/migrations/20261110100000_concessions.sql in Supabase.';
const wHeaders = (env, prefer = 'return=minimal') => ({
  apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', prefer,
});
export const amendmentUrl = (billId, stageId, amendmentId) => `https://bills.parliament.uk/bills/${billId}/stages/${stageId}/amendments/${amendmentId}`;

const shape = (r) => ({
  billId: r.bill_id, stageId: r.stage_id, amendmentId: r.amendment_id, house: r.house, number: r.number || '', place: r.place || '', summary: r.summary || '',
  url: r.url || (r.bill_id ? amendmentUrl(r.bill_id, r.stage_id, r.amendment_id) : ''), billTitle: r.bill_title || '', name: r.name || '', period: r.period || '', manual: !!r.manual || r.bill_id === 0, portfolio: (r.portfolio || '').split(',').filter(Boolean),
  notes: r.notes || '', wonBy: r.won_by || '', wonAt: r.won_at, updatedBy: r.updated_by || '', updatedAt: r.updated_at,
});

export async function onRequestGet({ env }) {
  if (!supabaseConfigured(env)) return fail('Supabase settings are missing in Cloudflare.', 503);
  try {
    const rows = await sbSelect(env, 'concessions', 'select=*&order=won_at.desc&limit=1000');
    return json({ concessions: rows.map(shape), portfolios: PORTFOLIOS.map((p) => ({ code: p.code, name: p.name })) });
  } catch (err) {
    if (missingTable(err)) return fail(MISSING, 503);
    return errorResponse(err);
  }
}

/** The Bill's title and portfolio now: from the live lists if it is a live Bill, otherwise from the Bill itself (its title places it). */
async function billSnapshot(ctx, billId) {
  const lists = await Promise.all([safe(activeBillsTagged(ctx, 'Lords'), []), safe(activeBillsTagged(ctx, 'Commons'), [])]);
  const live = lists.flat().find((b) => b.id === billId);
  if (live) return { title: live.title, codes: live.portfolios || [] };
  const b = await safe(billById(billId), null);
  const title = pick(b, 'shortTitle') || '';
  return { title, codes: tagBill({ title, longTitle: pick(b, 'longTitle') || '', summary: pick(b, 'summary') || '' }).codes || [] };
}

const PORTFOLIO_CODES = new Set(PORTFOLIOS.map((p) => p.code));
async function addManual({ env }, body) {
  const billTitle = cleanLine(body.billTitle, 200);
  if (!billTitle) return fail('Give the Bill.');
  if (body.wonAt && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.wonAt))) return fail('Give the date won as a date.');
  const codes = (Array.isArray(body.portfolio) ? body.portfolio : []).map((c) => String(c).toUpperCase()).filter((c) => PORTFOLIO_CODES.has(c));
  const row = { bill_id: 0, stage_id: 0, house: 'lords', bill_title: billTitle, name: cleanLine(body.name, 200) || null, portfolio: [...new Set(codes)].join(','),
    notes: cleanBlock(body.notes, 4000), period: cleanLine(body.period, 40) || null, manual: true, won_by: cleanLine(body.author, 80) || null };
  if (body.wonAt) row.won_at = `${body.wonAt}T12:00:00Z`;
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/concessions`, { method: 'POST', headers: wHeaders(env, 'return=representation'), body: JSON.stringify([row]) });
    if (!res.ok) throw new Error(`Supabase concessions: ${res.status} ${await res.text()}`);
    const [saved] = await res.json();
    return json({ ok: true, amendmentId: saved && saved.amendment_id });
  } catch (err) {
    if (missingTable(err)) return fail(MISSING, 503);
    if (/column|schema cache|nextval/.test(String(err.message))) return fail('Run supabase/migrations/20261111100000_concessions_manual.sql in Supabase first.', 503);
    return errorResponse(err);
  }
}

export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  let body;
  try { body = await request.json(); } catch { return fail('Send JSON.'); }
  const refused = await passcodeProblem(request, env);
  if (refused) return refused;
  if (!supabaseConfigured(env)) return fail('Supabase settings are missing in Cloudflare.', 503);
  if (body.action === 'add') return addManual(ctx, body);
  const manualRow = body.action !== 'win' && Number(body.billId) === 0 && Number(body.stageId) === 0;   // a concession added by hand
  const billId = posInt(body.billId), stageId = posInt(body.stageId), amendmentId = posInt(body.amendmentId);
  if ((!manualRow && (!billId || !stageId)) || !amendmentId) return fail('Unknown amendment.');
  const key = `bill_id=eq.${billId}&stage_id=eq.${stageId}&amendment_id=eq.${amendmentId}`;
  const author = cleanLine(body.author, 80) || null;
  const flags = `${env.SUPABASE_URL}/rest/v1/amendment_flags`;
  const table = `${env.SUPABASE_URL}/rest/v1/concessions`;
  try {
    if (body.action === 'win') {
      if (body.on) {
        const snap = await billSnapshot(ctx, billId);
        const row = {
          bill_id: billId, stage_id: stageId, amendment_id: amendmentId, house: body.house === 'commons' ? 'commons' : 'lords',
          number: cleanLine(body.number, 20) || null, place: cleanLine(body.place, 300) || null, summary: cleanLine(body.summary, 600) || null,
          url: amendmentUrl(billId, stageId, amendmentId), bill_title: cleanLine(snap.title, 200) || null, portfolio: snap.codes.join(','), won_by: author,
        };
        // an amendment already here keeps its notes and its date: only the snapshot is renewed
        const res = await fetch(`${table}?on_conflict=bill_id,stage_id,amendment_id`, { method: 'POST', headers: wHeaders(env, 'resolution=merge-duplicates,return=minimal'), body: JSON.stringify([row]) });
        if (!res.ok) throw new Error(`Supabase concessions: ${res.status} ${await res.text()}`);
        const fl = await fetch(flags, { method: 'POST', headers: wHeaders(env, 'resolution=merge-duplicates,return=minimal'), body: JSON.stringify([{ bill_id: billId, stage_id: stageId, amendment_id: amendmentId, flag: 'win', set_by: author, set_at: new Date().toISOString() }]) });
        if (!fl.ok) throw new Error(`Supabase amendment_flags: ${fl.status} ${await fl.text()}`);
      } else {
        const res = await fetch(`${table}?${key}`, { method: 'DELETE', headers: wHeaders(env) });
        if (!res.ok) throw new Error(`Supabase concessions: ${res.status} ${await res.text()}`);
        const fl = await fetch(`${flags}?${key}&flag=eq.win`, { method: 'DELETE', headers: wHeaders(env) });
        if (!fl.ok) throw new Error(`Supabase amendment_flags: ${fl.status} ${await fl.text()}`);
      }
      return json({ ok: true, on: !!body.on });
    }
    if (body.action === 'remove') {
      const res = await fetch(`${table}?${key}`, { method: 'DELETE', headers: wHeaders(env) });
      if (!res.ok) throw new Error(`Supabase concessions: ${res.status} ${await res.text()}`);
      if (billId) {
        const fl = await fetch(`${flags}?${key}&flag=eq.win`, { method: 'DELETE', headers: wHeaders(env) });
        if (!fl.ok) throw new Error(`Supabase amendment_flags: ${fl.status} ${await fl.text()}`);
      }
      return json({ ok: true });
    }
    if (body.action === 'remove') {
      const res = await fetch(`${table}?${key}`, { method: 'DELETE', headers: wHeaders(env) });
      if (!res.ok) throw new Error(`Supabase concessions: ${res.status} ${await res.text()}`);
      if (billId) {
        const fl = await fetch(`${flags}?${key}&flag=eq.win`, { method: 'DELETE', headers: wHeaders(env) });
        if (!fl.ok) throw new Error(`Supabase amendment_flags: ${fl.status} ${await fl.text()}`);
      }
      return json({ ok: true });
    }
    if (body.action === 'edit') {
      // the notes, and the Bill's name and the date it was won, which can be corrected by hand
      const patch = { updated_by: author, updated_at: new Date().toISOString() };
      if (body.notes !== undefined) patch.notes = cleanBlock(body.notes, 4000);
      if (body.billTitle !== undefined) { patch.bill_title = cleanLine(body.billTitle, 200) || null; }
      if (body.name !== undefined) patch.name = cleanLine(body.name, 200) || null;
      if (body.wonAt !== undefined) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.wonAt))) return fail('Give the date won as a date.');
        patch.won_at = `${body.wonAt}T12:00:00Z`;
        patch.period = null;   // an exact date replaces a season such as "Summer 2025"
      }
      const res = await fetch(`${table}?${key}`, { method: 'PATCH', headers: wHeaders(env), body: JSON.stringify(patch) });
      if (!res.ok) throw new Error(`Supabase concessions: ${res.status} ${await res.text()}`);
      return json({ ok: true });
    }
    if (body.action === 'note') {
      const res = await fetch(`${table}?${key}`, { method: 'PATCH', headers: wHeaders(env), body: JSON.stringify({ notes: cleanBlock(body.notes, 4000), updated_by: author, updated_at: new Date().toISOString() }) });
      if (!res.ok) throw new Error(`Supabase concessions: ${res.status} ${await res.text()}`);
      return json({ ok: true });
    }
    return fail('Unknown action.');
  } catch (err) {
    if (missingTable(err)) return fail(MISSING, 503);
    return errorResponse(err);
  }
}
