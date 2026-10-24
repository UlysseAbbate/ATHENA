// Short lines for the grids and theme lines for the hymn sheets, written by Claude and stored.
//   POST { action: 'lookup', ids }                                     → stored lines (no passcode needed)
//   POST { action: 'describe', passcode, billId, stageId, items }      → writes and stores lines (≤ 20 per call)
//   POST { action: 'themes', passcode, groupingId, groups }            → writes and stores hymn-sheet themes
import { json, errorResponse } from '../../../lib/libby/util.js';
import { sbSelect, sbUpsert, supabaseConfigured } from '../../../lib/libby/supabase.js';
import { extractJSON } from '../../../lib/libby/claude.js';
import { passcodeProblem, cleanLine, cleanBlock } from '../../../lib/libby/auth.js';

const posInt = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : 0; };

const DESCRIBE = `You write the middle column ("Member's Explanatory Statement") of a Liberal Democrat Lords Whips' Office amendment grid.
For each amendment write ONE neutral, factual line of at most 40 words, starting "Would …" (or "Seeks to …" where the statement says the amendment seeks to or probes something).
Example: "Would require the FCA to report annually on financial inclusion and lay the report before Parliament."
Base each line only on the explanatory statement and text supplied (other amendments in the list may explain what a clause does). Lightly trim; never add facts.
Common short forms are fine where the text uses them: FCA, PRA, FOS, FSMA 2000, CCA 1974.
With no statement: "Leave out Clause X" → "Would leave out Clause X" (adding what the clause does only if clear from the list); an amendment to another amendment → "As an amendment to Am X, this amendment would …"; a stand part notice → "Notice of intention to oppose Clause X standing part of the Bill."
Reply with JSON only: {"items":[{"id":123,"text":"…"}]}`;

const THEMES = `You write theme lines for a Liberal Democrat Lords Whips' Office Report Stage hymn sheet.
For each group write 1–3 sentences on what unites its amendments, starting "This Group relates to …".
Base it only on the topic and amendment lines supplied. No invented detail and no voting positions.
Reply with JSON only: {"themes":[{"group":"1","text":"…"}]}`;

async function claude(env, system, user, maxTokens) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set in Cloudflare.');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: env.GRID_MODEL || 'claude-haiku-4-5-20251001', max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return extractJSON((data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n'));
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Send JSON.' }, { status: 400 }); }
  if (!supabaseConfigured(env)) return json({ error: 'Supabase settings are missing in Cloudflare.' }, { status: 503 });
  try {
    if (body.action === 'lookup') {
      const ids = [...new Set((body.ids || []).map(posInt).filter(Boolean))].slice(0, 400);
      if (!ids.length) return json({ descriptions: {} });
      const rows = await sbSelect(env, 'amendment_descriptions', `select=amendment_id,description&amendment_id=in.(${ids.join(',')})`);
      return json({ descriptions: Object.fromEntries(rows.map((r) => [r.amendment_id, r.description])) });
    }

    const refused = await passcodeProblem(request, env);
    if (refused) return refused;

    if (body.action === 'describe') {
      const stageId = posInt(body.stageId);
      const items = (body.items || []).slice(0, 20).map((a) => ({
        id: posInt(a.id), number: cleanLine(a.number, 12), location: cleanLine(a.location, 300),
        mes: cleanBlock(a.mes, 1500), text: (a.text || []).slice(0, 12).map((t) => cleanBlock(t, 600)).join('\n'),
      })).filter((a) => a.id);
      if (!items.length) return json({ descriptions: {} });
      const user = items.map((a) => `id: ${a.id}\nAmendment ${a.number || '(no number)'}\nLocation: ${a.location}\nExplanatory statement: ${a.mes || '(none)'}\nText:\n${a.text.slice(0, 2500)}`).join('\n\n---\n\n');
      const parsed = await claude(env, DESCRIBE, user, 2500);
      const wanted = new Set(items.map((a) => a.id));
      const rows = (parsed.items || []).filter((x) => wanted.has(Number(x.id)) && x.text)
        .map((x) => ({ amendment_id: Number(x.id), stage_id: stageId || null, description: cleanLine(x.text, 600) }));
      if (rows.length) await sbUpsert(env, 'amendment_descriptions', rows);
      return json({ descriptions: Object.fromEntries(rows.map((r) => [r.amendment_id, r.description])) });
    }

    if (body.action === 'themes') {
      const id = posInt(body.groupingId);
      const groups = (body.groups || []).slice(0, 80).map((g) => ({ number: cleanLine(g.number, 6), topic: cleanLine(g.topic, 200), lines: (g.lines || []).slice(0, 30).map((l) => cleanLine(l, 400)) }));
      if (!id || !groups.length) return json({ error: 'Nothing to summarise.' }, { status: 400 });
      const user = groups.map((g) => `Group ${g.number}: ${g.topic}\n${g.lines.map((l) => `- ${l}`).join('\n')}`).join('\n\n');
      const parsed = await claude(env, THEMES, user, 3000);
      const numbers = new Set(groups.map((g) => g.number));
      const themes = Object.fromEntries((parsed.themes || []).filter((t) => numbers.has(String(t.group))).map((t) => [String(t.group), cleanBlock(t.text, 800)]));
      const res = await fetch(`${env.SUPABASE_URL}/rest/v1/groupings?id=eq.${id}`, {
        method: 'PATCH',
        headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', prefer: 'return=minimal' },
        body: JSON.stringify({ themes }),
      });
      if (!res.ok) throw new Error(`Supabase groupings: ${res.status} ${await res.text()}`);
      return json({ themes });
    }
    return json({ error: 'Unknown action.' }, { status: 400 });
  } catch (err) { return errorResponse(err); }
}
