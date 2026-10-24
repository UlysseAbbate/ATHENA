// Reading a Government Whips' Office "Grouping of amendments" document, and matching it to the
// amendments published for the stage (the same amendments as the marshalled list).

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** "1, 2, g12, 70★, 15 (already debated), Clause 3 stand part, AC12" → refs. */
export function parseRefs(text) {
  const refs = [];
  let rest = String(text || '');
  // "Clause 3 stand part" / "Schedule 2 stand part" notices first, so their numbers aren't read as amendments.
  rest = rest.replace(/\b(clause|schedule)\s+(\d+[A-Z]?)\s+stand\s+part\b/gi, (m, kind, n) => {
    refs.push({ ref: `${kind[0].toUpperCase()}${kind.slice(1).toLowerCase()} ${n.toUpperCase()} stand part`, num: '', kind: 'standpart', part: kind.toLowerCase(), clause: n.toUpperCase(), gov: false, debated: false });
    return ' ';
  });
  const re = /(^|[\s,;(\[])(g)?((?:AC|C)?\d+[A-Z]{0,2})(?!\d)(?:\s*(★|\*))?(\s*[(\[]\s*(?:already\s+|previously\s+)?debated[^)\]]*[)\]])?/gi;
  let m;
  while ((m = re.exec(rest))) {
    const raw = m[3].toUpperCase();
    const running = /^A?C\d/.test(raw);
    refs.push({
      ref: `${m[2] ? 'g' : ''}${raw}${m[4] ? '★' : ''}`,
      num: running ? '' : raw,
      kind: running ? (raw.startsWith('AC') ? 'after' : 'clause') : 'number',
      clause: running ? raw.replace(/^A?C/, '') : '',
      gov: !!m[2],
      debated: !!m[5],
    });
  }
  return refs;
}

export const refsToText = (refs) => refs.map((r) => `${r.ref}${r.debated ? ' (already debated)' : ''}`).join(', ');

function headerInfo(lines) {
  const text = lines.join('\n');
  const day = (text.match(/\bday\s+(\d+)\b/i) || [])[1];
  const d = text.match(/\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i);
  const date = d ? `${d[3]}-${String(MONTHS.indexOf(d[2].toLowerCase()) + 1).padStart(2, '0')}-${String(Number(d[1])).padStart(2, '0')}` : '';
  const stage = /\breport\b/i.test(text) ? 'report' : /\bcommittee\b/i.test(text) ? 'committee' : /consideration|ping pong|motions/i.test(text) ? 'pingpong' : '';
  return { title: lines.find((l) => l.trim()) || '', day: day ? Number(day) : null, date, stage };
}

/** Turn table rows ([cell, cell, cell]) into groups. Group numbers are often Word's automatic list
 *  numbering (not real text), so when a row has no written number, groups are numbered in order. */
function groupsFromRows(rows) {
  const groups = [];
  const isNum = (c) => /^(group\s*)?\d+\s*\.?$/i.test(c);
  // How "amendment-list-like" a cell is: numbers count for it, ordinary words against it.
  const score = (c) => (c.match(/\d+/g) || []).length - (c.match(/[a-z]{4,}/gi) || []).filter((w) => !/^(clause|schedule|stand|part|already|debated|previously)$/i.test(w)).length;
  for (const cells of rows) {
    const clean = cells.map((c) => c.replace(/\s+/g, ' ').trim());
    const numIdx = clean.findIndex(isNum);
    const others = clean.filter((c, i) => i !== numIdx && c);
    if (!others.length) continue;
    const refsText = [...others].sort((a, b) => score(b) - score(a))[0];
    if (!/\d/.test(refsText) || score(refsText) <= 0) continue; // a heading row, not a group
    const topic = others.filter((c) => c !== refsText).join(' ').trim();
    const number = numIdx >= 0 ? clean[numIdx].replace(/\D/g, '') : String(groups.length + 1);
    groups.push({ number, topic, refs: parseRefs(refsText) });
  }
  return groups;
}

/** Parse word/document.xml from a grouping .docx. `DOMParserImpl` is the browser's DOMParser. */
export function parseGroupingXml(xml, DOMParserImpl = globalThis.DOMParser) {
  const doc = new DOMParserImpl().parseFromString(xml, 'application/xml');
  const paraText = (p) => [...p.getElementsByTagNameNS(W, 't')].map((t) => t.textContent).join('');
  const body = doc.getElementsByTagNameNS(W, 'body')[0];
  const before = [];
  for (const node of [...(body?.childNodes || [])]) {
    if (node.localName === 'tbl') break;
    if (node.localName === 'p') before.push(paraText(node));
  }
  const rows = [...doc.getElementsByTagNameNS(W, 'tr')].map((tr) => [...tr.childNodes].filter((c) => c.localName === 'tc')
    .map((tc) => [...tc.getElementsByTagNameNS(W, 'p')].map(paraText).join(' ')));
  return { ...headerInfo(before), groups: groupsFromRows(rows) };
}

/** Best-effort reading of a grouping pasted as text (a Word table pastes as tab-separated lines). */
export function parseGroupingText(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const rows = [];
  const header = [];
  for (const line of lines) {
    if (line.includes('\t')) { rows.push(line.split('\t')); continue; }
    const m = line.match(/^\s*(?:group\s*)?(\d+)\s*[.:)\-–]\s*(.+)$/i);
    if (m) {
      const [refs, ...topic] = m[2].split(/\s+[–—-]\s+|\s{2,}/);
      rows.push([m[1], refs, topic.join(' ')]);
    } else if (!rows.length) header.push(line);
  }
  return { ...headerInfo(header), groups: groupsFromRows(rows) };
}

/** Amendment numbers compared without "g", stars or spaces. */
export const normNum = (s) => String(s || '').replace(/^g/i, '').replace(/[★*\s]/g, '').toUpperCase();

/** Attach the matching published amendment(s) to every reference. */
export function matchGroups(groups, amendments) {
  const byNum = new Map(amendments.map((a) => [normNum(a.number), a]));
  const unmatched = [];
  const out = groups.map((g) => ({
    ...g,
    refs: g.refs.map((r) => {
      let found = [];
      if (r.kind === 'number') found = byNum.has(r.num) ? [byNum.get(r.num)] : [];
      else if (r.kind === 'standpart') found = amendments.filter((a) => /delete|stand/i.test(a.type || '') && String(r.part === 'schedule' ? a.schedule : a.clause) === r.clause);
      else if (r.kind === 'after') found = amendments.filter((a) => /^add|insert/i.test(a.type || '') && String(a.clause) === r.clause && /new clause/i.test(a.place || ''));
      else if (r.kind === 'clause') found = amendments.filter((a) => String(a.clause) === r.clause && !/new clause|new schedule/i.test(a.place || ''));
      if (!found.length && !r.debated) unmatched.push(r.ref);
      return { ...r, matches: found };
    }),
  }));
  return { groups: out, unmatched };
}
