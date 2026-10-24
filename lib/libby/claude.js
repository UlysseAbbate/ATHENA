// Calls the Anthropic Messages API. Used to suggest Lib Dem supplementary questions
// for Lords Oral Questions, grounded in previous Lib Dem contributions and party policy.

const DEFAULT_MODEL = 'claude-sonnet-5';

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
