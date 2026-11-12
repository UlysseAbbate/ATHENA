// A speakers' list shared before the Today's List (about 48 hours before a debate), with the debate's advisory backbench speaking time.
// Reading is done by /api/day/:date (the list and the time come with the debate); this route only changes things. Staff and Admin (the Whips' Office features).
//   POST /api/debate-speakers { action: 'save', date, title, speakers: ['Lord X', ...], advisoryMinutes?, author }   save (replaces that debate's earlier upload)
//   POST /api/debate-speakers { action: 'remove', date, title }                                                    delete it
// The page times each speaker from this (see sitting-times.js, speakerPlan). Once the Today's List has its own speakers, the Today's List is used instead.
import { json, errorResponse, isIsoDate } from '../../../lib/libby/util.js';
import { supabaseConfigured } from '../../../lib/libby/supabase.js';
import { passcodeProblem, cleanLine } from '../../../lib/libby/auth.js';
import { titleKey } from '../../../site/libby/js/docs/speakers-upload.js';

const missingTable = (err) => /debate_speakers/.test(String(err.message)) && /does not exist|relation|schema cache/.test(String(err.message));
const MISSING = 'The speakers-list table has not been created yet: run supabase/migrations/20261112100000_lords_timings.sql in Supabase.';
const headers = (env, prefer = 'return=minimal') => ({ apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', prefer });
const NAME = /^(?:the\s+)?(?:lord|baroness|baron|viscount|earl|duke|lady|countess|marquess|archbishop|bishop)\b/i;

export async function onRequestPost({ request, env }) {
  const refused = await passcodeProblem(request, env);
  if (refused) return refused;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Send JSON.' }, { status: 400 }); }
  if (!supabaseConfigured(env)) return json({ error: 'Supabase settings are missing in Cloudflare.' }, { status: 503 });
  if (!isIsoDate(body.date)) return json({ error: 'Unknown date.' }, { status: 400 });
  const title = cleanLine(body.title, 300);
  const key = titleKey(title);
  if (!key) return json({ error: 'Which debate is this for?' }, { status: 400 });
  const table = `${env.SUPABASE_URL}/rest/v1/debate_speakers`;
  try {
    if (body.action === 'remove') {
      const res = await fetch(`${table}?list_date=eq.${body.date}&title_key=eq.${encodeURIComponent(key)}`, { method: 'DELETE', headers: headers(env) });
      if (!res.ok) throw new Error(`Supabase debate_speakers: ${res.status} ${await res.text()}`);
      return json({ ok: true });
    }
    if (body.action !== 'save') return json({ error: 'Unknown action.' }, { status: 400 });
    const seen = new Set();
    const speakers = (Array.isArray(body.speakers) ? body.speakers : []).slice(0, 150).map((n) => cleanLine(n, 100)).filter((n) => NAME.test(n) && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase())).map((name) => ({ name }));
    if (!speakers.length) return json({ error: 'I could not find any peers in that list. Each should start with Lord, Baroness, Viscount, Earl, Bishop ...' }, { status: 400 });
    const adv = Number(body.advisoryMinutes);
    const advisory = Number.isInteger(adv) && adv >= 1 && adv <= 60 ? adv : null;
    const row = { list_date: body.date, title_key: key, title, speakers, advisory_minutes: advisory, uploaded_by: cleanLine(body.author, 80) || null, uploaded_at: new Date().toISOString() };
    const res = await fetch(table, { method: 'POST', headers: headers(env, 'resolution=merge-duplicates,return=minimal'), body: JSON.stringify([row]) });
    if (!res.ok) throw new Error(`Supabase debate_speakers: ${res.status} ${await res.text()}`);
    return json({ ok: true, speakers: speakers.length, advisoryMinutes: advisory });
  } catch (err) {
    if (missingTable(err)) return json({ error: MISSING }, { status: 503 });
    return errorResponse(err);
  }
}
