// The uploaded Today's List and the advisers' settings for the day. Reading is done by /api/day/:date (which includes all of this);
// this route only changes things. Staff and Admin (the Whips' Office features).
//   POST /api/todays-list { action: 'upload', date, data, rawText, author }   save a list read from the PDF in the browser (replaces that day's list; keeps that day's settings)
//   POST /api/todays-list { action: 'remove', date }                          delete that day's list and settings
//   POST /api/todays-list { action: 'show', date, show: true|false }          show or hide every estimated time for the day
//   POST /api/todays-list { action: 'section', date, name, start }            set the start time of a sitting ("HH:MM"; empty to clear)
//   POST /api/todays-list { action: 'item', date, key, patch: { start, minutes, hidden } | null }   change one item's estimate (null puts it back)
//   POST /api/todays-list { action: 'speaker', date, key, add | remove: name } add or remove a peer who is speaking in an item
//   POST /api/todays-list { action: 'rules', rules: { oq: 40, ... } }         the lengths used for estimating, for every day (see public/js/docs/sitting-times.js)

import { json, errorResponse, isIsoDate } from '../../../lib/libby/util.js';
import { sbSelect, supabaseConfigured } from '../../../lib/libby/supabase.js';
import { passcodeProblem, cleanLine } from '../../../lib/libby/auth.js';
import { sanitizeList, cleanSettings } from '../../../lib/libby/list-store.js';
import { hhmmToMinutes, mergeRules, DEFAULT_RULES } from '../../../site/libby/js/docs/sitting-times.js';

const missingTable = (err) => /todays_lists|site_settings/.test(String(err.message)) && /does not exist|relation|schema cache/.test(String(err.message));
const MISSING = 'The Today’s List tables have not been created yet: run supabase/migrations/005_todays-list.sql in Supabase.';
const MAX_RAW = 200000;

const headers = (env, prefer = 'return=minimal') => ({
  apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', prefer,
});
async function must(res, what) {
  if (!res.ok) throw new Error(`Supabase ${what}: ${res.status} ${await res.text()}`);
  return res;
}

export async function onRequestPost({ request, env }) {
  const refused = await passcodeProblem(request, env);
  if (refused) return refused;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Send JSON.' }, { status: 400 }); }
  if (!supabaseConfigured(env)) return json({ error: 'Supabase settings are missing in Cloudflare.' }, { status: 503 });

  const action = body?.action;
  const author = cleanLine(body?.author, 80) || null;
  const now = new Date().toISOString();
  const table = `${env.SUPABASE_URL}/rest/v1/todays_lists`;

  try {
    if (action === 'rules') { // for every day
      const changes = mergeRules(body.rules);
      const stored = {};
      for (const [k, v] of Object.entries(changes)) if (JSON.stringify(v) !== JSON.stringify(DEFAULT_RULES[k])) stored[k] = v; // only what differs from the defaults
      await must(await fetch(`${env.SUPABASE_URL}/rest/v1/site_settings`, { method: 'POST', headers: headers(env, 'resolution=merge-duplicates,return=minimal'),
        body: JSON.stringify([{ key: 'sitting_rules', value: stored, updated_by: author, updated_at: now }]) }), 'site_settings');
      return json({ ok: true, rules: changes });
    }

    const date = body?.date;
    if (!isIsoDate(date)) return json({ error: 'Unknown date.' }, { status: 400 });

    if (action === 'upload') {
      let list;
      try { list = sanitizeList(body.data); } catch (err) { return json({ error: err.message }, { status: 400 }); }
      if (list.date !== date) return json({ error: `That list is for ${list.date}, not ${date}.` }, { status: 400 });
      await must(await fetch(table, { method: 'POST', headers: headers(env, 'resolution=merge-duplicates,return=minimal'),
        body: JSON.stringify([{ list_date: date, data: list, raw_text: String(body.rawText || '').slice(0, MAX_RAW), uploaded_by: author, uploaded_at: now, updated_by: author, updated_at: now }]) }), 'todays_lists');
      return json({ ok: true, date, sections: list.sections.length, items: list.sections.reduce((n, s) => n + s.items.length, 0) });
    }
    if (action === 'remove') {
      await must(await fetch(`${table}?list_date=eq.${date}`, { method: 'DELETE', headers: headers(env) }), 'todays_lists');
      return json({ ok: true });
    }

    // everything else changes the settings of a day that has a list
    const [row] = await sbSelect(env, 'todays_lists', `select=list_date,settings&list_date=eq.${date}`);
    if (!row) return json({ error: 'There is no list for that day: upload one first.' }, { status: 404 });
    const settings = cleanSettings(row.settings);

    if (action === 'show') settings.show = body.show !== false;
    else if (action === 'section') {
      if (!['Chamber', 'Grand Committee'].includes(body.name)) return json({ error: 'Unknown sitting.' }, { status: 400 });
      if (hhmmToMinutes(body.start) !== null) settings.sections[body.name] = { start: body.start }; else delete settings.sections[body.name];
    } else if (action === 'item') {
      const key = String(body.key || '');
      if (!/^[a-z0-9:#-]{1,90}$/.test(key)) return json({ error: 'Unknown item.' }, { status: 400 });
      const keepSpeakers = settings.items[key] && settings.items[key].speakers;
      delete settings.items[key];
      if (body.patch) settings.items[key] = { ...body.patch, ...(keepSpeakers ? { speakers: keepSpeakers } : {}) };
    } else if (action === 'speaker') {
      const key = String(body.key || '');
      if (!/^[a-z0-9:#-]{1,90}$/.test(key)) return json({ error: 'Unknown item.' }, { status: 400 });
      const mine = settings.items[key] || (settings.items[key] = {});
      const speakers = mine.speakers || [];
      const name = cleanLine(body.add || body.remove, 100);
      if (!name) return json({ error: 'Enter a name.' }, { status: 400 });
      if (body.add) { if (!speakers.some((s) => s.name.toLowerCase() === name.toLowerCase())) speakers.push({ name }); }
      else { const at = speakers.findIndex((s) => s.name.toLowerCase() === name.toLowerCase()); if (at >= 0) speakers.splice(at, 1); }
      if (speakers.length) mine.speakers = speakers; else delete mine.speakers;
    } else return json({ error: 'Unknown action.' }, { status: 400 });

    const clean = cleanSettings(settings);
    await must(await fetch(`${table}?list_date=eq.${date}`, { method: 'PATCH', headers: headers(env), body: JSON.stringify({ settings: clean, updated_by: author, updated_at: now }) }), 'todays_lists');
    return json({ ok: true, settings: clean });
  } catch (err) {
    if (missingTable(err)) return json({ error: MISSING }, { status: 503 });
    return errorResponse(err);
  }
}
