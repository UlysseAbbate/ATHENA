// Committee reports and correspondence that mention a statutory instrument: the Committees API searched for the instrument's name (best effort; the
// Secondary Legislation Scrutiny Committee, the Joint Committee on Statutory Instruments and subject committees all write about them).
import { getJSON, pick } from './util.js';

const COMMITTEES = 'https://committees-api.parliament.uk/api';

/** The words worth searching for: the instrument's name without "The" and the year. */
export const searchTermFor = (name) => String(name || '').replace(/^the\s+/i, '').replace(/\s+\(?\d{4}\)?\s*$/, '').replace(/\s+/g, ' ').trim().slice(0, 120);

export async function instrumentReports(name, take = 8) {
  const term = searchTermFor(name);
  if (term.length < 8) return [];
  const data = await getJSON(`${COMMITTEES}/Publications?SearchTerm=${encodeURIComponent(`"${term}"`)}&Take=${take}`, { timeout: 25000 });
  return (pick(data, 'items') || []).map((p) => {
    const doc = (pick(p, 'documents') || [])[0];
    const id = pick(p, 'id');
    return {
      id, title: pick(p, 'description') || '', date: String(pick(p, 'publicationStartDate') || '').slice(0, 10),
      committee: pick(pick(p, 'committee') || {}, 'name') || '', type: pick(pick(p, 'type') || {}, 'name') || '',
      url: pick(p, 'url') || (doc ? `https://committees.parliament.uk/publications/${id}/documents/${pick(doc, 'documentId', 'id') || ''}/default/` : `https://committees.parliament.uk/publications/${id}/`),
    };
  }).filter((r) => r.title);
}
