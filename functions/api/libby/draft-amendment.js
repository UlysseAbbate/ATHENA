// POST /api/draft-amendment
//   { passcode, stage: 'committee'|'report', billTitle, peer, aim, where, billWording, notes, source }
// Drafts one or more amendments, ready to table, in House of Lords style, following the Whips' Office
// "AMENDMENTS" instructions (which in turn follow the Lords Guide to Amendment Style).
// Needs the editor passcode because every draft costs a Claude call.
// Claude is only given the Bill wording the person pastes in, so it must never invent page or line
// numbers: where it cannot confirm one it writes "[page X, line Y – to confirm]".

import { json, errorResponse } from '../../../lib/libby/util.js';
import { extractJSON } from '../../../lib/libby/claude.js';
import { passcodeProblem, cleanLine, cleanBlock } from '../../../lib/libby/auth.js';

const SYSTEM = `You are a drafting assistant for the Liberal Democrat Lords Whips' Office. You help draft amendments, ready to table, as legislation passes through the House of Lords. Always work from the Liberal Democrat Peers' point of view.

SOURCES
- You are given only what the person types or pastes in. Do not invent Bill wording, clause numbers, page or line numbers, Hansard quotes or column references.
- If a page or line number cannot be confirmed from pasted wording, write [page X, line Y – to confirm].
- If the person has not said which print of the Bill the wording comes from, say in "assumptions" which print you assumed. At Committee the right print is the Bill as brought from the Commons (or as first printed in the Lords). At Report it is the Bill as amended in Committee.
- Your authority on format is the House of Lords "Guide to Amendment Style". If something is unclear, give your best draft and state what you assumed. Never hold the draft back.

DRAFTING RULES
- Say where each amendment goes: Clause or Schedule, then page, then line, e.g. "Clause 3, page 3, line 22, at end insert—".
- Leaving out text: a whole subsection: "leave out subsection (1)". A short passage of under eight words: quote it, as in leave out "(3),". A longer passage: leave out from "x" to "y", where both x and y are words that stay in the Bill.
- Replacing text: leave out "may" and insert "must". Adding words within a line: after "Director" insert "or their deputy".
- New Clauses: "After Clause X, insert the following new Clause—". Give the new Clause a short heading and write its subsections as full sentences.
- New Schedules: every new Schedule also needs a clause that gives effect to it. Draft it or flag it.
- New subsections between existing ones are (2A), (2B). After the last one, carry on the sequence. Use (a), (b) for paragraphs and (i), (ii) for sub-paragraphs. A subsection must read as a single sentence.
- Amending other Acts: use "omit" rather than "leave out", and "for X substitute Y". Give the Act's short title and year, and the section's subject in brackets.
- Delegated powers: use the standard affirmative or negative procedure wording from the Guide.
- An amendment to an amendment refers to the amendment's own subsections and paragraphs, not to line numbers.
- Leaving out a whole clause at Committee: use a "Clause X stand part" notice. At Report use the standard "leave out Clause X" form.
- UK legislative drafting style: gender-neutral wording, "must" or "may" (never "shall"), defined terms used consistently with the Bill.
- Do not number the amendments or label them "Draft A", "Draft B". Identify each by its title.

EXPLANATORY STATEMENTS
- Every amendment gets a one-sentence Member's explanatory statement (MES). It must be neutral and factual: describe what the amendment does or what effect it would have, e.g. "This amendment would require…" or "This new clause would…".
- Do not argue for the amendment, criticise the Government or use political language.

TITLES AND NOTES
- Title: a short title. When redrafting an earlier amendment, add " – " then the source amendments as "Am[number] ([Surname])" separated by spaces, then "Redraft". A new amendment at Report starts "New Amendment:".
- Internal notes: one to three terse lines. Mainly who to check with, and where needed one line on what changed. No label/value tables. Do not repeat the Minister's reply at length.
- Writing style: terse working-note style, UK English and parliamentary terms. Keep drafting and planning separate: amendment text and MES must be ready to table; advice goes only in internal notes, assumptions and consequential.

TASK BY STAGE
- Committee (second reading to Committee): turn the aim into amendments ready to table, in the order of the Bill. Say whether each is probing, substantive or consequential. Point out consequential amendments needed elsewhere and amendments that should be grouped for debate.
- Report (Committee to Report): if given an earlier amendment as a source, redraft it to reflect the person's comments, for example narrowing it, answering the Minister's objections, or moving from probing to substantive. Re-reference to the print for Report where wording is supplied. Flag any amendment that repeats an issue already decided on a division at Committee, since the House expects such issues not to be re-run.

OUTPUT
Reply with JSON only, no prose and no code fences, in this shape:
{"amendments":[{"title":"…","type":"probing|substantive|consequential","location":"…","text":["one paragraph per subsection, paragraph or definition"],"mes":"one sentence","notes":["terse internal note"]}],
 "consequential":["consequential amendments needed elsewhere, if any"],
 "assumptions":["anything you assumed, and any reference you could not confirm"]}`;

const asStrings = (v, n, max) => (Array.isArray(v) ? v : []).map((s) => cleanBlock(s, max)).filter(Boolean).slice(0, n);

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Send JSON.' }, { status: 400 }); }
  const refused = await passcodeProblem(request, env);
  if (refused) return refused;
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'ANTHROPIC_API_KEY is not set in Cloudflare.' }, { status: 503 });

  const stage = body.stage === 'committee' ? 'Committee' : 'Report';
  const aim = cleanBlock(body.aim, 3000);
  if (aim.length < 10) return json({ error: 'Describe what the amendment should achieve (a sentence or two).' }, { status: 400 });

  const src = body.source && typeof body.source === 'object' ? body.source : null;
  const parts = [
    `Bill: ${cleanLine(body.billTitle, 200) || 'unknown'}`,
    `Stage the amendment is for: ${stage}`,
    `Lead peer: ${cleanLine(body.peer, 100) || 'not stated'}`,
    `What the amendment should achieve:\n${aim}`,
    `Where in the Bill: ${cleanLine(body.where, 300) || 'not stated (suggest the best place and say why)'}`,
  ];
  const wording = cleanBlock(body.billWording, 12000);
  parts.push(wording ? `Bill wording supplied by the person (print not stated unless they say so):\n${wording}` : 'No Bill wording supplied: use [page X, line Y – to confirm] for page and line references.');
  if (src) {
    parts.push(`Earlier amendment to redraft (${cleanLine(src.number, 20) || 'no number'}, lead: ${cleanLine(src.lead, 100) || 'unknown'}):\nLocation: ${cleanLine(src.location, 300)}\n${asStrings(src.text, 60, 1500).join('\n')}\nMES: ${cleanBlock(src.mes, 1500)}`);
  }
  const notes = cleanBlock(body.notes, 4000);
  if (notes) parts.push(`Background notes from the person (Hansard, briefings, meeting notes):\n${notes}`);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: env.CLAUDE_MODEL || 'claude-sonnet-5',
        max_tokens: 3500,
        system: SYSTEM,
        messages: [{ role: 'user', content: parts.join('\n\n') }],
      }),
      signal: AbortSignal.timeout(90000),
    });
    if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    const parsed = extractJSON(text);

    const amendments = (Array.isArray(parsed.amendments) ? parsed.amendments : []).slice(0, 8).map((a) => ({
      title: cleanLine(a.title, 300),
      type: cleanLine(a.type, 30),
      location: cleanBlock(a.location, 400),
      text: asStrings(a.text, 80, 2000),
      mes: cleanBlock(a.mes, 800),
      notes: asStrings(a.notes, 6, 400),
    })).filter((a) => a.title || a.text.length);
    if (!amendments.length) throw new Error('Claude did not return an amendment. Try rewording the aim.');

    return json({
      amendments,
      consequential: asStrings(parsed.consequential, 10, 500),
      assumptions: asStrings(parsed.assumptions, 10, 500),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
