// POST /api/oq-suggest  { date, peer, question, minister, dept, refresh? }
// Suggests two Lib Dem supplementary questions for a Lords Oral Question.
// Claude searches Parallel Parliament and Hansard (web search restricted to those domains)
// and is given matching extracts from the Lib Dem policy library in Supabase.
// Results are cached in Supabase so each question is only generated once.

import { json, errorResponse, safe } from '../../../lib/libby/util.js';
import { callClaude, extractJSON, OQ_SYSTEM } from '../../../lib/libby/claude.js';
import { sbSelect, sbUpsert, sbRpc, supabaseConfigured } from '../../../lib/libby/supabase.js';

const STOP = new Set('what which whether they their there have been being with from that this will would could should into about under over make made plans steps taking take government majesty his her ask assessment impact number people after before other such those these also more most than only upon'.split(' '));

async function cacheKey(date, question) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${date}|${question}`));
  return [...new Uint8Array(buf)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function keywords(text) {
  return [...new Set(String(text).toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/\s+/)
    .filter((w) => w.length > 4 && !STOP.has(w)))].slice(0, 6);
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Send JSON.' }, { status: 400 }); }
  const { date = '', peer = '', question = '', minister = '', dept = '', refresh = false } = body || {};
  if (!question || question.length < 10) return json({ error: 'A question text is required.' }, { status: 400 });

  const key = await cacheKey(date, question);
  if (!refresh && supabaseConfigured(env)) {
    const hit = await safe(sbSelect(env, 'oq_suggestions', `select=payload,created_at&key=eq.${key}`), []);
    if (hit.length) return json({ ...hit[0].payload, cached: true, generatedAt: hit[0].created_at });
  }

  // Lib Dem policy extracts relevant to the question (full-text search in Supabase).
  const terms = keywords(question);
  const policy = terms.length
    ? await safe(sbRpc(env, 'search_policy', { q: terms.join(' or '), portfolio: null, max_results: 4 }), [])
    : [];
  const policyText = policy.length
    ? policy.map((p) => `- ${p.title} (${p.date_label || 'undated'}): ${String(p.extract_text).replace(/<\/?mark>/g, '')} [${p.source_url}]`).join('\n')
    : '- (No matching extracts found in the policy library.)';

  const user = `Lords Oral Question${date ? ` for ${date}` : ''}
Asked by: ${peer || 'unknown'}
Question: To ask His Majesty's Government ${question}
Answering Minister: ${minister || 'unknown'} (${dept || 'department unknown'})

Liberal Democrat policy extracts from our library:
${policyText}

Suggest two supplementary questions for a Liberal Democrat peer, following your method.`;

  try {
    const { text, searched } = await callClaude(env, {
      system: OQ_SYSTEM,
      user,
      tools: [{
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: 5,
        allowed_domains: ['parallelparliament.co.uk', 'hansard.parliament.uk', 'libdems.org.uk'],
      }],
    });
    const parsed = extractJSON(text);
    // Only keep source URLs Claude actually saw in search results, or our own policy links.
    const seen = new Set([...searched.map((s) => s.url), ...policy.map((p) => p.source_url)]);
    const questions = (parsed.questions || []).slice(0, 2).map((q) => ({
      question: q.question,
      basis: q.basis,
      sources: (q.sources || []).filter((s) => s && s.url && seen.has(s.url)),
    }));
    const payload = {
      questions,
      note: parsed.note || '',
      policyUsed: policy.map((p) => ({ title: p.title, url: p.source_url, date: p.date_label })),
    };
    await safe(sbUpsert(env, 'oq_suggestions', [{ key, payload }]));
    return json({ ...payload, cached: false, generatedAt: new Date().toISOString() });
  } catch (err) {
    return errorResponse(err);
  }
}
