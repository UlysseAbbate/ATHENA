// Puts a day's grid together: the saved grouping + the amendments published for the stage
// (sponsors, Lib Dem flags) + one short line per amendment for the grid's middle column.
// Those lines are written by Claude once (when an adviser saves the grouping) and stored, so
// later downloads are instant. Without them, the Member's explanatory statement is used instead.
import { matchGroups } from './grouping.js';

const trimWords = (s, n) => { const w = String(s).trim().split(/\s+/); return w.length > n ? `${w.slice(0, n).join(' ')}…` : w.join(' '); };

/** The line used when no Claude-written line exists: the explanatory statement, lightly trimmed. */
export function fallbackText(detail, a) {
  const mes = (detail?.explanatoryStatement || '').trim();
  if (mes) return trimWords(mes, 70);
  const body = [...(detail?.text || []), a.summary || ''].join(' ');
  const toAm = body.match(/as an amendment to amendment\s+(\d+[A-Z]*)/i);
  if (toAm) return `As an amendment to Am ${toAm[1]}.`;
  const leave = body.match(/\bleave out (clause|schedule) (\d+[A-Z]*)\b/i);
  if (leave) return `Would leave out ${leave[1][0].toUpperCase()}${leave[1].slice(1).toLowerCase()} ${leave[2]}.`;
  if (/stand part/i.test(a.place || '')) return '';
  return a.place ? `${a.place}.` : '';
}

async function pool(items, size, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

/** Short lines for each amendment: stored ones first, then (with a passcode) new ones from Claude. */
export async function getDescriptions({ api, billId, stageId, items, passcode = '', refresh = false, onProgress = () => {} }) {
  const out = {};
  if (!refresh && items.length) {
    try { Object.assign(out, (await api('grid-text', { method: 'POST', body: JSON.stringify({ action: 'lookup', ids: items.map((a) => a.id) }) })).descriptions || {}); }
    catch { /* nothing stored yet, or the table is missing: fall through */ }
  }
  const missing = items.filter((a) => !out[a.id]);
  let generated = 0; let fallbacks = 0; let warning = '';
  if (!missing.length) return { descriptions: out, generated, fallbacks, warning };

  const details = {};
  let done = 0;
  await pool(missing, 5, async (a) => {
    try { details[a.id] = await api(`bills/${billId}/amendment?stage=${stageId}&aid=${a.id}`); } catch { details[a.id] = null; }
    onProgress(`Reading amendments: ${++done} of ${missing.length}`);
  });

  if (passcode) {
    for (let i = 0; i < missing.length; i += 15) {
      const batch = missing.slice(i, i + 15).map((a) => ({
        id: a.id, number: a.number, location: details[a.id]?.location || a.place || '',
        mes: details[a.id]?.explanatoryStatement || '', text: (details[a.id]?.text || []).slice(0, 12),
      }));
      onProgress(`Writing the grid text: ${Math.min(i + 15, missing.length)} of ${missing.length}`);
      try {
        const r = await api('grid-text', { method: 'POST', body: JSON.stringify({ action: 'describe', passcode, billId: Number(billId), stageId: Number(stageId), items: batch }) });
        for (const [id, text] of Object.entries(r.descriptions || {})) { out[id] = text; generated++; }
      } catch (err) {
        warning = err.message;
        if (/passcode/i.test(err.message)) break;
      }
    }
  }
  for (const a of missing) if (!out[a.id]) { out[a.id] = fallbackText(details[a.id], a); fallbacks++; }
  return { descriptions: out, generated, fallbacks, warning };
}

const shownNum = (r, a) => (r.kind === 'number' ? (a?.number || r.ref.replace(/^g/, '')) : r.ref);

/**
 * grouping: a saved grouping row ({ groups: [ { number, topic, refs } ] })
 * amendments: the stage's amendments (from /api/bills/:id/amendments → all)
 * Returns { groups: [ { number, topic, refsLabel, rows: [ { num, peers, text } ] } ], unmatched, generated, fallbacks, warning }
 */
export async function assembleDay({ api, billId, stageId, grouping, amendments, passcode, refresh, onProgress }) {
  const { groups, unmatched } = matchGroups(grouping.groups, amendments);
  const outGroups = groups.map((g) => ({ number: g.number, topic: g.topic, refsLabel: g.refs.filter((r) => !r.debated).map((r) => r.ref.replace(/^g/, '')).join(', '), rows: [] }));
  const unique = new Map();
  groups.forEach((g, gi) => g.refs.forEach((r) => {
    if (r.debated) return; // "already debated" amendments never appear in the grid
    if (!r.matches.length) {
      outGroups[gi].rows.push({ num: r.ref.replace(/^g/, ''), peers: [], text: 'Not found in the amendments published for this stage: check the marshalled list.', id: null });
      return;
    }
    for (const a of r.matches) {
      unique.set(a.id, a);
      outGroups[gi].rows.push({ num: shownNum(r, a), peers: a.sponsors.map((s) => ({ name: s.name, ld: !!s.ld })), id: a.id });
    }
  }));
  const d = await getDescriptions({ api, billId, stageId, items: [...unique.values()], passcode, refresh, onProgress });
  for (const g of outGroups) for (const row of g.rows) if (row.id) row.text = d.descriptions[row.id] || '';
  return { groups: outGroups, unmatched, generated: d.generated, fallbacks: d.fallbacks, warning: d.warning };
}

/** Theme lines for the hymn sheet: stored ones, or new ones from Claude (with a passcode), or a plain fallback. */
export async function getThemes({ api, grouping, groups, passcode = '', refresh = false }) {
  const stored = grouping.themes || {};
  if (!refresh && groups.every((g) => stored[g.number])) return { themes: stored, generated: false };
  if (passcode) {
    try {
      const r = await api('grid-text', {
        method: 'POST',
        body: JSON.stringify({ action: 'themes', passcode, groupingId: grouping.id, groups: groups.map((g) => ({ number: g.number, topic: g.topic, lines: g.rows.map((x) => x.text).filter(Boolean).slice(0, 30) })) }),
      });
      return { themes: r.themes || {}, generated: true };
    } catch (err) { return { themes: fallbackThemes(groups, stored), generated: false, warning: err.message }; }
  }
  return { themes: fallbackThemes(groups, stored), generated: false };
}

const fallbackThemes = (groups, stored) => Object.fromEntries(groups.map((g) => [g.number, stored[g.number] || `This Group relates to ${g.topic ? g.topic.charAt(0).toLowerCase() + g.topic.slice(1) : 'the amendments listed'}.`]));
