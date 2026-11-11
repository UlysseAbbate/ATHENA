// Parliamentary process (Whips Hub): answers a question about procedure from Erskine May and the Lords Companion.
//   1  the question is turned into a few search phrases (Claude, or the question's own key words if that is not available)
//   2  Erskine May is searched live through its API (https://erskinemay-api.parliament.uk); the best sections are read in full
//   3  the Lords Companion, which the Whips' Office uploads as a PDF (it cannot be fetched automatically), is searched in the database
//   4  Claude writes the answer from those passages ONLY, citing them [1], [2] ...; if they do not answer the question it says so
// Nothing is made up: every source is listed with a link or a paragraph number, so the answer can be checked.
import { getJSON, pick, decodeEntities, safe } from './util.js';
import { sbRpc, supabaseConfigured } from './supabase.js';
import { extractJSON } from './claude.js';

const EM = 'https://erskinemay-api.parliament.uk/api';
const STOP = new Set('a an the of to in on for and or but is are was were be been being do does did can could may might must shall should will would what when where which who whom how why if it its this that these those there their they them i we you my our your with without about from by at as into than then so not no any some'.split(' '));
// tried in this order (after CLAUDE_MODEL, if set): a model name the account does not have is skipped, not fatal
const MODELS = ['claude-sonnet-5-5', 'claude-sonnet-5', 'claude-sonnet-4-5'];

const text = (html) => decodeEntities(String(html || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** The question's own key words, as search phrases, when Claude is not available. */
export function keywordQueries(question) {
  const words = String(question || '').toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
  const uniq = [...new Set(words)];
  if (!uniq.length) return [];
  const out = [uniq.slice(0, 3).join(' ')];
  if (uniq.length > 3) out.push(uniq.slice(3, 6).join(' '));
  if (uniq.length > 0) out.push(uniq[0]);
  return [...new Set(out.filter(Boolean))].slice(0, 3);
}

/** One Claude call. Tries each model name in turn (a 404 means the account has no such model), and tries once more after a busy/overloaded answer (429, 5xx). */
export async function claude(env, { system, user, maxTokens = 1500, timeout = 60000, fetcher = fetch }) {
  const models = [...new Set([env.CLAUDE_MODEL, ...MODELS].filter(Boolean))];
  let last = null;
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let res;
      try {
        res = await fetcher('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
          signal: AbortSignal.timeout(timeout),
        });
      } catch (err) { last = new Error(/timeout|abort/i.test(String(err)) ? 'Claude took too long to answer' : `Claude could not be reached (${err.message})`); break; }
      if (res.ok) {
        const data = await res.json();
        return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      }
      const detail = (await res.text()).slice(0, 200);
      last = new Error(res.status === 401 || res.status === 403 ? 'the ANTHROPIC_API_KEY in Cloudflare was refused' : res.status === 404 ? `Claude has no model called ${model}` : `Claude API ${res.status}: ${detail}`);
      if (res.status === 404) break;                         // try the next model name
      if (res.status === 401 || res.status === 403 || res.status === 400) throw last;   // another model will not help
      if (!(res.status === 429 || res.status >= 500)) break;
      await new Promise((r) => setTimeout(r, 1500));         // busy: once more
    }
  }
  throw last || new Error('Claude did not answer');
}

/** Short search phrases for a question: Claude if it can, else the key words. */
export async function searchPhrases(env, question) {
  if (env && env.ANTHROPIC_API_KEY) {
    try {
      const out = extractJSON(await claude(env, {
        system: 'You turn a question about UK parliamentary procedure into search phrases for Erskine May and the Lords Companion. Reply with JSON only: {"queries":["...", "..."]} with 2 to 4 short phrases (1 to 4 words each, the terms the books themselves would use, e.g. "ping pong", "money bill", "privilege amendment").',
        user: String(question).slice(0, 1000), maxTokens: 200, timeout: 12000,
      }));
      const q = (out.queries || []).map((x) => String(x).trim()).filter(Boolean).slice(0, 4);
      if (q.length) return q;
    } catch { /* fall back to the key words */ }
  }
  return keywordQueries(question);
}

/** Erskine May: the sections that match the phrases best, each read in full (capped). */
export async function erskineSections(queries, { sections = 4, chars = 2600 } = {}) {
  const score = new Map();   // sectionId -> { hits, ref, title, chain, chapter }
  await Promise.all(queries.map(async (q, qi) => {
    const data = await safe(getJSON(`${EM}/Search/ParagraphSearchResults/${encodeURIComponent(q)}?skip=0&take=8`, { timeout: 20000 }), null);
    for (const [i, r] of (pick(data || {}, 'searchResults') || []).entries()) {
      const id = pick(r, 'sectionId');
      if (!id) continue;
      const cur = score.get(id) || { id, hits: 0, ref: pick(r, 'paragraphReference') || '', title: pick(r, 'sectionTitle') || '', chain: pick(r, 'sectionTitleChain') || '', chapter: pick(r, 'chapterTitle') || '' };
      cur.hits += 10 - i + (qi === 0 ? 3 : 0);   // earlier results and the first phrase count for more
      if (!cur.ref && pick(r, 'paragraphReference')) cur.ref = pick(r, 'paragraphReference');
      score.set(id, cur);
    }
  }));
  const best = [...score.values()].sort((a, b) => b.hits - a.hits).slice(0, sections);
  return (await Promise.all(best.map(async (s) => {
    const d = await safe(getJSON(`${EM}/Section/${s.id}`, { timeout: 20000 }), null);
    const body = d ? text(pick(d, 'contentHtml')) : '';
    return body ? { source: 'Erskine May', id: s.id, ref: s.ref, title: s.title || pick(d, 'title') || '', where: [pick(d, 'chapterTitle') ? `Chapter ${pick(d, 'chapterNumber')}: ${pick(d, 'chapterTitle')}` : '', s.chain].filter(Boolean).join(' › '), body: body.slice(0, chars), url: `https://erskinemay.parliament.uk/section/${s.id}/` } : null;
  }))).filter(Boolean);
}

/** The Lords Companion pieces that match, from the database (none if it has not been uploaded). */
export async function companionPieces(env, queries, { limit = 5, chars = 1800 } = {}) {
  if (!supabaseConfigured(env)) return [];
  const seen = new Map();
  for (const q of queries) {
    const rows = await safe(sbRpc(env, 'search_process', { q, max_results: 6 }), []);
    for (const r of rows || []) if (!seen.has(r.id) || seen.get(r.id).rank < r.rank) seen.set(r.id, r);
  }
  return [...seen.values()].sort((a, b) => b.rank - a.rank).slice(0, limit)
    .map((r) => ({ source: 'Lords Companion', id: r.id, ref: r.ref || '', title: r.heading || '', where: [r.edition, r.page ? `page ${r.page}` : ''].filter(Boolean).join(', '), body: String(r.body).slice(0, chars), url: '' }));
}

export const ANSWER_SYSTEM = `You answer questions about UK parliamentary procedure for the Liberal Democrat Whips' Office. You are given numbered passages from Erskine May and from the Lords Companion to the Standing Orders. Use ONLY those passages.
Rules:
- Give the direct answer first, then the detail and any exceptions, in plain UK English. Say which House it applies to: Erskine May covers both Houses; the Lords Companion is the Lords only.
- Cite the passages you rely on as [1], [2] and so on, right after the claim. Never cite a number you were not given. Never invent paragraph numbers, standing orders, dates or precedents.
- If the passages do not answer the question, say so plainly and say what the person should look up (do not guess). If they only partly answer it, say which part.
- Keep it short: a few paragraphs at most. This is guidance from the books, not a ruling: end with one line saying to check the cited passages (or the Clerks) for anything that matters.
Reply with JSON only: {"answer":"...","confidence":"clear"|"partial"|"not found","used":[1,2]}`;

/** Answer a question. Returns { answer, confidence, sources: [ { n, source, ref, title, where, url, excerpt, used } ], queries, note }. */
export async function answerQuestion(env, { question, house = '' }) {
  const queries = await searchPhrases(env, question);
  if (!queries.length) throw new Error('Ask the question in a few words.');
  const [em, comp] = await Promise.all([safe(erskineSections(queries), []), companionPieces(env, queries)]);
  const passages = [...(house === 'commons' ? em : [...comp, ...em])].map((p, i) => ({ ...p, n: i + 1 }));
  const note = comp.length ? '' : 'The Lords Companion has not been uploaded yet, or nothing in it matched, so this answer rests on Erskine May alone.';
  if (!passages.length) return { answer: 'Nothing in Erskine May or the Lords Companion matched that question. Try different words, or look it up directly.', confidence: 'not found', sources: [], queries, note };
  const listing = passages.map((p) => `[${p.n}] ${p.source}${p.ref ? ` ${p.ref}` : ''}${p.title ? ` (${p.title})` : ''}${p.where ? `, ${p.where}` : ''}\n${p.body}`).join('\n\n');
  const sources = (used = new Set()) => passages.map((p) => ({ n: p.n, source: p.source, ref: p.ref, title: p.title, where: p.where, url: p.url, excerpt: p.body.slice(0, 500), used: used.has(p.n) }));
  let out;
  try {
    const raw = await claude(env, { system: ANSWER_SYSTEM, user: `Question${house ? ` (about the House of ${house === 'commons' ? 'Commons' : 'Lords'})` : ''}: ${String(question).slice(0, 1500)}\n\nPassages:\n${listing}`, maxTokens: 1600, timeout: 55000 });
    try { out = extractJSON(raw); } catch { out = { answer: raw.trim(), confidence: 'partial', used: [...raw.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])) }; }   // not JSON: the text itself is the answer
  } catch (err) {
    // The passages were found but the answer could not be written: show them, so the page is still useful
    return { answer: `I found these passages but could not write the answer (${err.message}). Please try again in a minute, or read the passages below.`, confidence: 'not found', sources: sources(new Set(passages.map((p) => p.n))), queries, note: 'The answer was not written, so this question was not saved.', failed: true };
  }
  const used = new Set((Array.isArray(out.used) ? out.used : []).map(Number));
  return {
    answer: String(out.answer || '').slice(0, 6000), confidence: ['clear', 'partial', 'not found'].includes(out.confidence) ? out.confidence : 'partial',
    sources: sources(used), queries, note,
  };
}
