// Availability for whipping: for each day, who would prefer to be duty whip (green), has no preference (amber) or is not free (red).
//   GET  /api/whip-availability?from=YYYY-MM-DD&days=35  -> { from, to, entries: [ { date, whip, status } ] }
//   POST /api/whip-availability { whip, entries: [ { date, status: 'green'|'amber'|'red'|null } ] }   null clears that day
// Whips and above (Whip, Spokesperson, Leader's office, Staff, Admin; not Peers). Everyone shares a code, so the name is whatever the person chose: it is a record, not a login.
import { json, errorResponse, isIsoDate, londonToday, addDays } from '../../../lib/libby/util.js';
import { sbSelect, sbUpsert, supabaseConfigured } from '../../../lib/libby/supabase.js';
import { passcodeProblem, cleanLine } from '../../../lib/libby/auth.js';

const STATUSES = new Set(['green', 'amber', 'red']);

export async function onRequestGet({ request, env }) {
  const q = new URL(request.url).searchParams;
  const from = isIsoDate(q.get('from')) ? q.get('from') : londonToday();
  const days = Math.min(Math.max(Number(q.get('days')) || 35, 1), 120);
  const to = addDays(from, days - 1);
  if (!supabaseConfigured(env)) return json({ error: 'Supabase settings are missing in Cloudflare.' }, { status: 503 });
  try {
    const rows = await sbSelect(env, 'whip_availability', `select=duty_date,whip,status&duty_date=gte.${from}&duty_date=lte.${to}&order=duty_date.asc,whip.asc&limit=5000`);
    return json({ from, to, entries: rows.map((r) => ({ date: r.duty_date, whip: r.whip, status: r.status })) });
  } catch (err) {
    if (/whip_availability/.test(String(err.message)) && /does not exist|relation|schema cache/.test(String(err.message))) {
      return json({ error: 'The whip_availability table has not been created yet: run add-whips.sql in Supabase.' }, { status: 503 });
    }
    return errorResponse(err);
  }
}

export async function onRequestPost({ request, env }) {
  const refused = await passcodeProblem(request, env);
  if (refused) return refused;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Send JSON.' }, { status: 400 }); }
  if (!supabaseConfigured(env)) return json({ error: 'Supabase settings are missing in Cloudflare.' }, { status: 503 });

  const whip = cleanLine(body?.whip, 80);
  if (!whip) return json({ error: 'Choose your name first.' }, { status: 400 });
  const entries = (Array.isArray(body?.entries) ? body.entries : []).slice(0, 150);
  if (!entries.length) return json({ error: 'Nothing to save.' }, { status: 400 });
  const set = [];
  const clear = [];
  for (const e of entries) {
    if (!isIsoDate(e?.date)) return json({ error: 'Unknown date.' }, { status: 400 });
    if (STATUSES.has(e.status)) set.push({ duty_date: e.date, whip, status: e.status, updated_at: new Date().toISOString() });
    else if (e.status === null || e.status === '' || e.status === undefined) clear.push(e.date);
    else return json({ error: 'Unknown availability.' }, { status: 400 });
  }
  try {
    if (set.length) await sbUpsert(env, 'whip_availability', set);
    if (clear.length) {
      const res = await fetch(`${env.SUPABASE_URL}/rest/v1/whip_availability?whip=eq.${encodeURIComponent(whip)}&duty_date=in.(${clear.join(',')})`, {
        method: 'DELETE',
        headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, prefer: 'return=minimal' },
      });
      if (!res.ok) throw new Error(`Supabase whip_availability: ${res.status} ${await res.text()}`);
    }
    return json({ ok: true, saved: set.length, cleared: clear.length });
  } catch (err) {
    return errorResponse(err);
  }
}
