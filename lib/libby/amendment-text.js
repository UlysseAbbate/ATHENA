// Amendment wording from the Bills API carries formatting codes such as <b>...</b> (bold) and <i>...</i> (italics),
// sometimes as real tags and sometimes escaped (&lt;b&gt;). Shown as they come, they appear as stray "<b>" in the text.
// markupToPlain() turns either kind into plain words, so the page, the Word grids, the drafting tool and Claude's prompts
// all get clean text. (The page then escapes the text as always, so nothing from outside is ever treated as markup.)

import { decodeEntities } from './util.js';

const TAG = /<\/?[a-zA-Z][a-zA-Z0-9]*\b[^<>]*>/g; // a tag starts with < and a letter, so "x < y" is not mistaken for one
const ESCAPED_TAG = /&(?:lt|#0*60|#x0*3c);\s*\/?[a-z]/i;

export function markupToPlain(raw) {
  let s = String(raw ?? '');
  // Escaped tags become real tags first, so they can be removed like any other; a second pass catches double escaping.
  for (let pass = 0; pass < 3; pass++) {
    const before = s;
    s = decodeEntities(s)
      .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<(p|div|h[1-6])\b[^>]*>/gi, '\n')
      .replace(/<li[^>]*>/gi, '\n* ')
      .replace(/<\/(p|div|h[1-6]|li|tr|section|article|ul|ol|table)>/gi, '\n')
      .replace(TAG, '');
    if (s === before || !ESCAPED_TAG.test(s)) break;
  }
  return s
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .split('\n').map((l) => l.trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
