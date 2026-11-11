// Spreadsheet import, the reading part (no page code, so the website and `node scripts/libby/check-import.mjs` can both use it).
//   readWorkbook(XLSX, bytes)            an Excel (.xlsx/.xls) or CSV file -> { sheets: [ { name, headers, rows } ] }, finding the header row even under a title
//   matchColumns(headers, rows, fields)  which sheet column fills which field: by the heading (exact, then "contains", then a typo), then by what the cells look like (dates, links, emails)
//   cellValue(type, raw)                 a cell read as a date / link / email / text
// The point is that nobody has to format a sheet to suit the site: headings only need to be recognisable, and the page shows what it understood (with a drop-down to correct it) before anything is saved.
// To teach it a new heading, add it to that field's `aliases` in importers.js. See docs/IMPORTS.md.

const strip = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '');
/** A heading with everything but letters and digits taken out, lower case: "Date of action" -> "dateofaction". */
export const norm = (s) => strip(s).toLowerCase().replace(/[^a-z0-9]+/g, '');

function distance(a, b) {   // edit distance, for a typo or two in a heading
  if (Math.abs(a.length - b.length) > 2) return 9;
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) { const keep = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = keep; }
  }
  return row[b.length];
}

/** How well one heading fits one field, 0 to 100. */
export function headerScore(header, field) {
  const h = norm(header);
  if (!h) return 0;
  let best = 0;
  for (const alias of [field.key, field.label, ...(field.aliases || [])]) {
    const a = norm(alias);
    if (!a) continue;
    if (h === a) return 100;
    if (a.length >= 4 && h.includes(a)) best = Math.max(best, 80 - Math.min(20, h.length - a.length));
    else if (h.length >= 4 && a.includes(h)) best = Math.max(best, 70 - Math.min(20, a.length - h.length));
    else if (a.length >= 5 && distance(h, a) <= 1) best = Math.max(best, 65);
  }
  return best;
}

/* ------------------------------------------------------------------ values */

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const iso = (y, m, d) => {
  if (y < 100) y += 2000;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : '';
};
/** A date as 'YYYY-MM-DD', or '' if the cell is not a date. Day-first (UK) for 05/10/2026; also 2026-10-05, 5 Oct 2026, 5-Oct-26, Tuesday 5 October 2026, and Excel's own day numbers. */
export function parseDate(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return iso(v.getFullYear(), v.getMonth() + 1, v.getDate());
  let t = String(v ?? '').trim();
  if (!t) return '';
  if (/^\d{5}(\.\d+)?$/.test(t) && Number(t) > 20000 && Number(t) < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(t)) * 864e5); return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }
  t = t.replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+/i, '').replace(/(\d)(st|nd|rd|th)\b/i, '$1').replace(/\s*\d{1,2}[:.]\d{2}.*$/, '');
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(t); if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(t); if (m) return iso(+m[3], +m[2], +m[1]);
  m = /^(\d{1,2})[\s-]+([a-z]{3,})[a-z]*\.?,?[\s-]+(\d{2,4})$/i.exec(t); if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) return iso(+m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]);
  m = /^([a-z]{3,})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/i.exec(t); if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) return iso(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2]);
  return '';
}
const looksUrl = (t) => /^https?:\/\/\S+$/i.test(t) || /^www\.\S+\.\S+/i.test(t);
const looksEmail = (t) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t);

/** One cell read as the field's type: { value, ok } (an empty cell is ok with ''). */
export function cellValue(type, raw) {
  const t = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return { value: '', ok: true };
  if (type === 'date') { const d = parseDate(raw instanceof Date ? raw : t); return { value: d, ok: !!d }; }
  if (type === 'url') return looksUrl(t) ? { value: /^www\./i.test(t) ? `https://${t}` : t, ok: true } : { value: t, ok: false };
  if (type === 'email') return { value: t.toLowerCase(), ok: looksEmail(t) };
  return { value: t, ok: true };
}
/** Text that keeps its line breaks (notes, messages). */
export const blockValue = (raw) => String(raw ?? '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').trim();

/* ------------------------------------------------------------------ the workbook */

/** The row that holds the headings: the first of the first 15 rows with at least two filled cells that are mostly words, not numbers, and followed by a row with something in it. */
function headerRow(grid) {
  for (let i = 0; i < Math.min(grid.length, 15); i++) {
    const cells = grid[i].map((c) => String(c ?? '').trim());
    const filled = cells.filter(Boolean);
    const wordy = filled.filter((c) => /[a-z]/i.test(c) && !parseDate(c)).length;
    if (filled.length >= 2 && wordy >= Math.ceil(filled.length * 0.8) && grid.slice(i + 1, i + 4).some((r) => r.some((c) => String(c ?? '').trim()))) return i;
  }
  return 0;
}

/** Read an Excel or CSV file. `XLSX` is the SheetJS library; `bytes` an ArrayBuffer/Uint8Array. Dates come out as 'YYYY-MM-DD' text. */
export function readWorkbook(XLSX, bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  // A real Excel file (zip 'PK' or old 'D0CF') has true date cells. A CSV is only text, and the reader would guess dates the American way (05/10/2026 as May 10), so for a CSV it is told to leave every cell as written.
  const excel = (data[0] === 0x50 && data[1] === 0x4b) || (data[0] === 0xd0 && data[1] === 0xcf);
  const wb = XLSX.read(data, { type: 'array', cellDates: true, dateNF: 'yyyy-mm-dd', ...(excel ? {} : { raw: true }) });
  const sheets = [];
  for (const name of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, dateNF: 'yyyy-mm-dd', defval: '', blankrows: false });
    if (!grid.length) continue;
    const at = headerRow(grid);
    const headers = (grid[at] || []).map((h) => String(h ?? '').trim());
    const rows = grid.slice(at + 1).filter((r) => r.some((c) => String(c ?? '').trim()));
    if (headers.some(Boolean) && rows.length) sheets.push({ name, headers, rows });
  }
  return { sheets };
}

/* ------------------------------------------------------------------ matching columns to fields */

/** What a column's cells look like, as a share of its filled cells: { date, url, email, filled }. */
function sniff(rows, col) {
  const cells = rows.slice(0, 60).map((r) => String(r[col] ?? '').trim()).filter(Boolean);
  const share = (fn) => (cells.length ? cells.filter(fn).length / cells.length : 0);
  return { filled: cells.length, date: share((c) => !!parseDate(c)), url: share(looksUrl), email: share(looksEmail) };
}

/**
 * Work out which column fills which field. Returns { mapping: { [fieldKey]: columnIndex | -1 }, how: { [fieldKey]: 'heading' | 'contents' | '' }, unmatched: [column indexes nothing took] }.
 * By heading first (best fits taken first, each column used once); then a required or date/link/email field still without a column takes a column whose cells look right.
 */
export function matchColumns(headers, rows, fields) {
  const pairs = [];
  fields.forEach((f) => headers.forEach((h, c) => { const s = headerScore(h, f); if (s >= 60) pairs.push({ f: f.key, c, s }); }));
  pairs.sort((a, b) => b.s - a.s);
  const mapping = Object.fromEntries(fields.map((f) => [f.key, -1]));
  const how = Object.fromEntries(fields.map((f) => [f.key, '']));
  const used = new Set();
  for (const p of pairs) if (mapping[p.f] === -1 && !used.has(p.c)) { mapping[p.f] = p.c; how[p.f] = 'heading'; used.add(p.c); }
  const sniffs = headers.map((_, c) => sniff(rows, c));
  for (const f of fields.filter((x) => mapping[x.key] === -1 && ['date', 'url', 'email'].includes(x.type))) {
    const pick = sniffs.map((s, c) => ({ c, v: used.has(c) ? 0 : s[f.type] })).filter((x) => x.v >= 0.8).sort((a, b) => b.v - a.v)[0];
    if (pick) { mapping[f.key] = pick.c; how[f.key] = 'contents'; used.add(pick.c); }
  }
  return { mapping, how, unmatched: headers.map((_, c) => c).filter((c) => !used.has(c) && headers[c] && sniffs[c].filled) };
}

/** Score for choosing between importers for the same sheet: how many required fields found a column, then how many fields in all. */
export function fitScore(match, fields) {
  const got = fields.filter((f) => match.mapping[f.key] !== -1);
  const required = fields.filter((f) => f.required);
  return required.length && required.every((f) => match.mapping[f.key] !== -1) ? 100 + got.length : (required.filter((f) => match.mapping[f.key] !== -1).length / (required.length || 1)) * 50 + got.length;
}
