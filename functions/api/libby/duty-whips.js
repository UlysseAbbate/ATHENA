// The Duty Whips rota: two Whips for each day, chosen by Staff.
//   GET  /api/duty-whips?from=YYYY-MM-DD&days=35     -> { from, to, duty: { "2026-10-12": ["Lord A", "Baroness B"] } }   (Whips and above)
//   POST /api/duty-whips { date, slot: 1|2, whip, author }   whip empty = clear that slot                                 (Staff and Admin)
import { json, errorResponse, isIsoDate, londonToday, addDays } from '../../../lib/libby/util.js';
import { sbSelect, sbUpsert, supabaseConfigured } from '../../../lib/libby/supabase.js';
import { passcodeProblem, cleanLine } from '../../../lib/libby/auth.js';

const headers = (env) => ({ apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, prefer: 'return=minimal' });

export async function onRequestGet({ request, env }) {
  const q = new URL(request.url).searchParams;
  const from = isIsoDate(q.get('from')) ? q.get('from') : londonToday();
  const days = Math.min(Math.max(Number(q.get('days')) || 35, 1), 120);
  const to = addDays(from, days - 1);
  if (!supabaseConfigured(env)) return json({ error: 'Supabase settings are missing in Cloudflare.' }, { status: 503 });
  try {
    const rows = await sbSelect(env, 'duty_whips', `select=duty_date,slot,whip&duty_date=gte.${from}&duty_date=lte.${to}&order=duty_date.asc,slot.asc`);
    const duty = {};
    for (const r of rows) (duty[r.duty_date] ||= ['', ''])[r.slot - 1] = r.whip;
    return json({ from, to, duty });
  } catch (err) {
    if (/duty_whips/.test(String(err.message)) && /does not exist|relation|schema cache/.test(String(err.message))) {
      return json({ error: 'The duty_whips table has not been created yet: run add-whips.sql in Supabase.' }, { status: 503 });
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

  const date = body?.date;
  const slot = Number(body?.slot);
  const whip = cleanLine(body?.whip, 80);
  if (!isIsoDate(date)) return json({ error: 'Unknown date.' }, { status: 400 });
  if (slot !== 1 && slot !== 2) return json({ error: 'The slot must be 1 or 2.' }, { status: 400 });
  try {
    if (!whip) {
      const res = await fetch(`${env.SUPABASE_URL}/rest/v1/duty_whips?duty_date=eq.${date}&slot=eq.${slot}`, { method: 'DELETE', headers: headers(env) });
      if (!res.ok) throw new Error(`Supabase duty_whips: ${res.status} ${await res.text()}`);
      return json({ ok: true, cleared: true });
    }
    const other = await sbSelect(env, 'duty_whips', `select=whip&duty_date=eq.${date}&slot=eq.${slot === 1 ? 2 : 1}`);
    if (other[0]?.whip === whip) return json({ error: `${whip} is already the other duty whip that day.` }, { status: 400 });
    await sbUpsert(env, 'duty_whips', [{ duty_date: date, slot, whip, updated_by: cleanLine(body?.author, 80) || null, updated_at: new Date().toISOString() }]);
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
