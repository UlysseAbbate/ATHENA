// Reads the Lords Companion PDF in the browser (only its text is sent anywhere) and cuts it into numbered paragraphs for searching.
// The Companion numbers its paragraphs 1.1, 1.2 ... 12.34 (chapter.paragraph), with a short heading above each group: a piece is one numbered paragraph with the heading it sits under.
import { loadLib, PDFJS_WORKER } from './loader.js';

const MAX_BYTES = 40 * 1024 * 1024;
const PARA = /^(\d{1,2}\.\d{1,3})\s+(\S.*)$/;
const MAX_PIECE = 1800;

/** One page's text items -> lines, top to bottom (items on the same line, within a few points, are joined left to right). */
export function linesOfPage(items) {
  const rows = [];
  for (const it of items) {
    const s = String(it.str || '');
    if (!s.trim()) continue;
    const y = Math.round(it.y / 3);
    let row = rows.find((r) => r.y === y);
    if (!row) { row = { y, parts: [] }; rows.push(row); }
    row.parts.push({ x: it.x, s });
  }
  return rows.sort((a, b) => b.y - a.y).map((r) => r.parts.sort((a, b) => a.x - b.x).map((p) => p.s).join(' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
}

const isPageNoise = (line) => /^\d{1,3}$/.test(line) || /^(companion to the standing orders|house of lords)\b/i.test(line);
/** A heading is a short line, no closing punctuation, that comes after the end of a sentence. */
const looksLikeHeading = (line, prevEndedSentence) => prevEndedSentence && line.length <= 90 && line.split(' ').length <= 9 && !/[.;:,]$/.test(line) && /^[A-Z0-9(]/.test(line);

/** pages: [ { page, lines } ] -> [ { ref, heading, page, body } ]. Text before the first numbered paragraph (the contents, the foreword) is ignored. */
export function chunkPages(pages) {
  const out = [];
  let cur = null;
  let heading = '';
  let pending = '';          // a possible heading: used if the next line starts a numbered paragraph, otherwise it was ordinary text
  let prevEnded = true;
  const flush = () => { if (cur) { out.push(...splitLong(cur)); cur = null; } };
  for (const { page, lines } of pages) {
    for (const line of lines) {
      if (isPageNoise(line)) continue;
      const m = PARA.exec(line);
      if (m) {
        flush();
        if (pending) heading = pending;
        pending = '';
        cur = { ref: m[1], heading, page, body: m[2] };
        prevEnded = /[.?!)]$/.test(line);
        continue;
      }
      if (pending && cur) { cur.body += ` ${pending}`; pending = ''; }
      if (looksLikeHeading(line, prevEnded)) { pending = line; prevEnded = false; continue; }
      if (cur) cur.body += ` ${line}`;
      prevEnded = /[.?!)]$/.test(line);
    }
  }
  if (pending && cur) cur.body += ` ${pending}`;
  flush();
  return out.map((c) => ({ ...c, body: c.body.replace(/\s+/g, ' ').trim() })).filter((c) => c.body.length >= 30);
}

function splitLong(c) {
  if (c.body.length <= MAX_PIECE) return [c];
  const parts = [];
  let rest = c.body;
  while (rest.length > MAX_PIECE) {
    let cut = rest.lastIndexOf('. ', MAX_PIECE);
    if (cut < MAX_PIECE / 2) cut = MAX_PIECE;
    parts.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) parts.push(rest);
  return parts.map((body, i) => ({ ...c, ref: i ? `${c.ref} (part ${i + 1})` : c.ref, body }));
}

/** Read every page of the PDF: [ { page, lines } ]. `onProgress(done, total)` is called as it goes. */
export async function readPdfPages(file, onProgress = () => {}) {
  if (!file) throw new Error('Choose the Lords Companion PDF first.');
  if (file.size > MAX_BYTES) throw new Error('That file is over 40 MB: is it the right one?');
  const pdfjs = await loadLib('pdfjsLib');
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  let doc;
  try { doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise; } catch (err) {
    throw new Error(/password/i.test(String(err && err.message)) ? 'That PDF is password protected.' : 'That file could not be read as a PDF.');
  }
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    pages.push({ page: n, lines: linesOfPage(content.items.map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5] }))) });
    if (n % 10 === 0 || n === doc.numPages) onProgress(n, doc.numPages);
  }
  if (pages.reduce((n, p) => n + p.lines.length, 0) < 50) throw new Error('There is hardly any text in that PDF (is it a scan?).');
  return pages;
}
