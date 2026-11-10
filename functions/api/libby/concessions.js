// The Concessionometer (Lib Dems 150): every amendment marked WIN, kept whether or not its Bill is still live.
//   GET  /api/libby/concessions
//        -> { concessions: [ { billId, stageId, amendmentId, house, number, place, summary, url, billTitle, portfolio: ['HO', ...], notes, wonBy, wonAt, updatedBy, updatedAt } ] }, newest first
//   POST { action: 'win', on, billId, stageId, amendmentId, house, number?, place?, summary?, author? }
//        on: true marks the amendment WIN (the WIN button) and adds it here, with a snapshot of its Bill's title and portfolio; false takes it off again.
//   POST { action: 'note', billId, stageId, amendmentId, notes, author? }   the POLD Staff's notes about the concession
// Reading: everyone signed in. Changing: the Whips' Office features (Staff), as for the other amendment buttons.
import { json, errorResponse, safe, pick } from '../../../lib/libby/util.js';
import { sbSelect, supabaseConfigured } from '../../../lib/libby/supabase.js';
import { passcodeProblem, cleanLine, cleanBlock } from '../../../lib/libby/auth.js';
import { bill as billById, activeBillsTagged } from '../../../lib/libby/parliament.js';
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
  url: r.url || amendmentUrl(r.bill_id, r.stage_id, r.amendment_id), billTitle: r.bill_title || '', portfolio: (r.portfolio || '').split(',').filter(Boolean),
  notes: r.notes || '', wonBy: r.won_by || '', wonAt: r.won_at, updatedBy: r.updated_by || '', updatedAt: r.updated_at,
});

export async function onRequestGet({ env }) {
  if (!supabaseConfigured(env)) return fail('Supabase settings are missing in Cloudflare.', 503);
  try {
    const rows = await sbSelect(env, 'concessions', 'select=*&order=won_at.desc&limit=1000');
    return json({ concessions: rows.map(shape) });
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

export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  let body;
  try { body = await request.json(); } catch { return fail('Send JSON.'); }
  const refused = await passcodeProblem(request, env);
  if (refused) return refused;
  if (!supabaseConfigured(env)) return fail('Supabase settings are missing in Cloudflare.', 503);
  const billId = posInt(body.billId), stageId = posInt(body.stageId), amendmentId = posInt(body.amendmentId);
  if (!billId || !stageId || !amendmentId) return fail('Unknown amendment.');
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
