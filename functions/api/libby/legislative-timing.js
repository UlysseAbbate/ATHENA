// Timing for the groups of amendments at Committee and Report stage in the Lords. Whips and above only (the rule is on the page in pages.js).
//   GET  /api/legislative-timing?date=YYYY-MM-DD
//        -> { date, stages: [ { billId, stageId, stageName, title, plans: [ { number, topic, minutes, speakers: [ { name, minutes, role } ], noSignatories, minister } ],
//             actuals: { '3': '15:42' } } ] }
//        one entry for each saved grouping (the Groupings upload on the adviser editor) whose sitting date is that day. The expected length of a group comes
//        from who signed its amendments (site/libby/js/docs/group-timing.js); the page lays the start times and the pace on top.
//   POST { action: 'start', date, billId, stageId, group, time? ('HH:MM', London; now if left out) }   note when a group really started
//   POST { action: 'clear', date, billId, stageId, group }                                            take that note off again
import { json, errorResponse, safe, cached, isIsoDate, londonMinutesNow } from '../../../lib/libby/util.js';
import { sbSelect, supabaseConfigured } from '../../../lib/libby/supabase.js';
import { passcodeProblem, cleanLine } from '../../../lib/libby/auth.js';
import { stageAmendments } from '../../../lib/libby/parliament.js';
import { planGroups } from '../../../site/libby/js/docs/group-timing.js';
import { mergeRules } from '../../../site/libby/js/docs/sitting-times.js';

const posInt = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : 0; };
const missingTable = (err) => /group_actuals/.test(String(err.message)) && /does not exist|relation|schema cache/.test(String(err.message));
const MISSING = 'The group-timing table has not been created yet: run supabase/migrations/20261112100000_lords_timings.sql in Supabase.';
const headers = (env, prefer = 'return=minimal') => ({ apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', prefer });

export async function onRequestGet(ctx) {
  const { request, env } = ctx;
  const date = new URL(request.url).searchParams.get('date') || '';
  if (!isIsoDate(date)) return json({ error: 'Pass ?date=YYYY-MM-DD.' }, { status: 400 });
  if (!supabaseConfigured(env)) return json({ error: 'Supabase settings are missing in Cloudflare.' }, { status: 503 });
  try {
    const [groupings, actuals, rulesRow] = await Promise.all([
      sbSelect(env, 'groupings', `select=bill_id,stage_id,stage_name,title,groups&sitting_date=eq.${date}&limit=8`),
      safe(sbSelect(env, 'group_actuals', `select=bill_id,stage_id,group_number,started_at&list_date=eq.${date}`), []),
      safe(sbSelect(env, 'site_settings', 'select=value&key=eq.sitting_rules'), []),
    ]);
    const rules = mergeRules(rulesRow[0] && rulesRow[0].value);
    const stages = await Promise.all(groupings.map(async (g) => {
      const amendments = await safe(cached(ctx, `stage-amendments-${g.bill_id}-${g.stage_id}`, 300, () => stageAmendments(g.bill_id, g.stage_id)), []);
      return {
        billId: g.bill_id, stageId: g.stage_id, stageName: g.stage_name || '', title: g.title || '',
        plans: planGroups(g.groups, amendments, rules), signatoriesFound: amendments.length > 0,
        actuals: Object.fromEntries(actuals.filter((a) => a.bill_id === g.bill_id && a.stage_id === g.stage_id).map((a) => [a.group_number, a.started_at])),
      };
    }));
    return json({ date, stages }, { maxAge: 0 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestPost({ request, env }) {
  const refused = await passcodeProblem(request, env);
  if (refused) return refused;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Send JSON.' }, { status: 400 }); }
  if (!supabaseConfigured(env)) return json({ error: 'Supabase settings are missing in Cloudflare.' }, { status: 503 });
  const billId = posInt(body.billId), stageId = posInt(body.stageId);
  const group = cleanLine(body.group, 8);
  if (!isIsoDate(body.date) || !billId || !stageId || !group) return json({ error: 'Which group is this?' }, { status: 400 });
  const key = `list_date=eq.${body.date}&bill_id=eq.${billId}&stage_id=eq.${stageId}&group_number=eq.${encodeURIComponent(group)}`;
  const table = `${env.SUPABASE_URL}/rest/v1/group_actuals`;
  try {
    if (body.action === 'clear') {
      const res = await fetch(`${table}?${key}`, { method: 'DELETE', headers: headers(env) });
      if (!res.ok) throw new Error(`Supabase group_actuals: ${res.status} ${await res.text()}`);
      return json({ ok: true });
    }
    if (body.action !== 'start') return json({ error: 'Unknown action.' }, { status: 400 });
    let time = String(body.time || '');
    if (!time) { const m = londonMinutesNow(); time = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }
    if (!/^[0-2]\d:[0-5]\d$/.test(time) || Number(time.slice(0, 2)) > 23) return json({ error: 'Give the time as HH:MM.' }, { status: 400 });
    const row = { list_date: body.date, bill_id: billId, stage_id: stageId, group_number: group, started_at: time, set_by: cleanLine(body.author, 80) || null, set_at: new Date().toISOString() };
    const res = await fetch(table, { method: 'POST', headers: headers(env, 'resolution=merge-duplicates,return=minimal'), body: JSON.stringify([row]) });
    if (!res.ok) throw new Error(`Supabase group_actuals: ${res.status} ${await res.text()}`);
    return json({ ok: true, time });
  } catch (err) {
    if (missingTable(err)) return json({ error: MISSING }, { status: 503 });
    return errorResponse(err);
  }
}
