// Calls the Anthropic Messages API. Used to suggest Lib Dem supplementary questions
// for Lords Oral Questions, grounded in previous Lib Dem contributions and party policy.

const DEFAULT_MODEL = 'claude-sonnet-5-5';

export async function callClaude(env, { system, user, tools = [], maxTokens = 1800 }) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set in Cloudflare.');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: env.CLAUDE_MODEL || DEFAULT_MODEL,
      max_tokens: maxTokens,
      system,
      tools,
      messages: [{ role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  // Collect every URL Claude actually visited, so the UI can show real sources.
  const searched = [];
  for (const block of data.content || []) {
    if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      for (const r of block.content) if (r.url) searched.push({ title: r.title || r.url, url: r.url });
    }
  }
  return { text, searched };
}

/** Pull the first JSON object out of a model reply (tolerates code fences or preamble). */
export function extractJSON(text) {
  const clean = String(text).replace(/```json|```/g, '');
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Claude did not return JSON.');
  return JSON.parse(clean.slice(start, end + 1));
}

export const OQ_SYSTEM = `You support the Liberal Democrat Lords Whips' Office in the House of Lords.
For a Lords Oral Question, you suggest exactly two supplementary questions a Liberal Democrat peer could ask the Minister.

Method:
1. Search parallelparliament.co.uk first (its pages index debates, questions and speeches by member and party), then hansard.parliament.uk, for previous contributions by Liberal Democrat MPs or peers on this topic. Prefer the last two years.
2. Use the Liberal Democrat policy extracts supplied in the prompt where relevant.
3. Build each supplementary on a concrete Lib Dem precedent (a speech, question, amendment, or policy). If you find no precedent, say so plainly in "basis" instead of inventing one.

House style for supplementaries: Lords register, one clear question each, under 60 words, may open "My Lords, …", courteous but pointed, no preamble about the Minister's answer.

Never invent quotations, statistics, dates, or column references. Only cite URLs you actually opened or saw in search results.

Reply with JSON only, no prose, in this shape:
{"questions":[{"question":"…","basis":"one sentence naming the Lib Dem precedent this builds on","sources":[{"title":"…","url":"…"}]}],"note":"optional one-line caveat"}`;

export const BILL_SUMMARY_SYSTEM = `You help the Liberal Democrat policy team in Parliament write a briefing on a Bill.
Write ONLY from the documents and text you are given (the Bill's official summary, its long title, its Parts, and the explanatory notes if attached). Never add facts, figures, dates or opinions that are not in them. If something is not covered, leave it out.
Style: UK English, plain and neutral, short sentences, no jargon, no adjectives of praise or blame.
Reply with JSON only, in this shape:
{"overview":"two to four sentences saying what the Bill does","parts":[{"heading":"Part 1: its title","summary":"one or two sentences on what that Part does"}]}
Give one entry in "parts" for each Part (or group of clauses) of the Bill, in order; if the Bill has no Parts, group the clauses by subject. At most 12 entries.`;

/**
 * Asks Claude for the "what the Bill does" paragraph and a high-level summary of its Parts for the Update document.
 * `input` = { title, longTitle, official, parts: [{ part, first, last, count, headings }], sources: [{ label, fileUrl }] }.
 * The explanatory notes (a PDF at a public address) are given to Claude to read when there are some; if that is refused (too large, say) it is asked again from the text alone.
 */
export async function summariseBill(env, input) {
  const text = [
    `Bill: ${String(input.title || '').slice(0, 200)}`,
    input.longTitle ? `Long title: ${String(input.longTitle).slice(0, 1500)}` : '',
    input.official ? `Official summary:\n${String(input.official).slice(0, 6000)}` : '',
    (input.parts || []).length ? `Parts (from the Act):\n${input.parts.slice(0, 40).map((p) => `- ${p.part}: sections ${p.first} to ${p.last} (${p.count}); for example: ${(p.headings || []).slice(0, 4).join('; ')}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
  const notes = (input.sources || []).find((s) => /explanatory notes/i.test(s.label) && /^https:\/\/bills-api\.parliament\.uk\//.test(s.fileUrl || ''));
  const ask = async (withNotes) => {
    const content = [];
    if (withNotes && notes) content.push({ type: 'document', source: { type: 'url', url: notes.fileUrl }, title: 'Explanatory notes' });
    content.push({ type: 'text', text });
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: env.CLAUDE_MODEL || DEFAULT_MODEL, max_tokens: 2500, system: BILL_SUMMARY_SYSTEM, messages: [{ role: 'user', content }] }),
      signal: AbortSignal.timeout(110000),
    });
    if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return extractJSON((data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n'));
  };
  let out;
  try { out = await ask(true); } catch (err) { if (!notes) throw err; out = await ask(false); }
  return {
    overview: String(out.overview || '').slice(0, 1500),
    parts: (Array.isArray(out.parts) ? out.parts : []).slice(0, 12).map((p) => ({ heading: String(p.heading || '').slice(0, 200), summary: String(p.summary || '').slice(0, 600) })).filter((p) => p.heading),
  };
}
