// Reading a speakers' list that has been shared before the Today's List exists (usually about 48 hours before the debate).
// The list is alphabetical at that stage; the Today's List puts the speakers in their real order later and then replaces it.
// The file can be a PDF, Word-free text, a CSV or an Excel sheet, or the names pasted in: whatever it is, it reaches here as lines of text.
// Plain functions (no browser objects) so the page and the tests both use them. The file itself is read in the browser (day-list.js).

import { expandName } from './list-parser.js';

const TITLE = /^(?:the\s+)?(?:lord|baroness|baron|viscount|earl|duke|lady|countess|marquess|archbishop|bishop|lord bishop|the lord bishop)\b/i;
const ABBREV = /^(?:L|B|V|E|D|M|C|Ly|Bp|Abp)\s+[A-Z][\w'’-]/;
const NOT_A_PEER = /^(?:lord speaker|lord chancellor|lord chair|lord (?:chief )?justice|lord president|baroness (?:the )?chair)\b/i;

/** Names (in the order given, once each) and the advisory speaking time found in the lines of a speakers' list. */
export function parseSpeakersText(input) {
  const lines = (Array.isArray(input) ? input : String(input || '').split(/\r?\n/)).map((l) => String(l ?? '').replace(/ /g, ' ').trim()).filter(Boolean);
  const names = [];
  const seen = new Set();
  let advisory = null;
  for (const line of lines) {
    if (advisory === null && /advis|backbench|speaking time|within|limit/i.test(line)) {
      const m = line.match(/(\d{1,2})\s*(?:minutes?|mins?)\b/i);
      if (m && Number(m[1]) >= 1 && Number(m[1]) <= 60) advisory = Number(m[1]);
    }
    const pieces = line.replace(/^\s*(?:\d+\s*[.):-]|[-•*])\s*/, '').split(/[;,\t|]|\s{3,}/);
    for (let piece of pieces) {
      piece = piece.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/\s+-\s+(?:con|lab|ld|lib dem|cb|crossbench|ind|bishop|lds?)\b.*$/i, '').replace(/^\s*\d+\s*[.):-]?\s*/, '').replace(/\s+/g, ' ').trim();
      if (!piece || piece.length > 90 || NOT_A_PEER.test(piece.replace(/^the\s+/i, ''))) continue;
      let name = '';
      if (TITLE.test(piece)) name = piece.replace(/^the\s+/i, '');
      else if (ABBREV.test(piece)) name = expandName(piece);
      if (!name || !TITLE.test(name) || name.split(' ').length < 2) continue;
      const k = name.toLowerCase();
      if (!seen.has(k)) { seen.add(k); names.push(name); }
    }
  }
  return { names, advisoryMinutes: advisory };
}

/** A debate's title as the short form used to match the same debate across the papers ("Armed Forces Bill" and "Armed Forces Bill: Report" share it up to 48 letters). */
export const titleKey = (title) => String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
