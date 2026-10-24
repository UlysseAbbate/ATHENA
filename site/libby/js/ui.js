// Small UI helpers shared by every view. No framework: views build HTML strings
// with esc() for anything that came from an API, then wire up events.

export const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

let ldKey = '';
let ldRe = null;
/** Remember the current Lib Dem peers so any text can be highlighted. The pattern is built once, not on every call. */
export function setLDPeers(names) {
  if (!Array.isArray(names) || !names.length) return;
  const list = [...new Set(names.filter(Boolean))].sort((a, b) => b.length - a.length); // longest first, so "Lord Smith of X" wins over "Lord Smith"
  const key = list.join('|');
  if (key === ldKey) return; // every API reply repeats the list: nothing to rebuild
  ldKey = key;
  const alternatives = list.map((name) => esc(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  ldRe = new RegExp(`(^|[^\\w>])(${alternatives})(?![\\w<])`, 'g');
}

/** Escape text, then wrap any Lib Dem peer's name in a highlighter mark. */
export function hl(text) {
  const out = esc(text);
  return ldRe ? out.replace(ldRe, '$1<mark class="ld">$2</mark>') : out;
}

/** A peer's name, highlighted if they are a Lib Dem (explicit flag or name match). */
export function peer(name, ld) {
  return ld ? `<mark class="ld">${esc(name)}</mark>` : hl(name);
}

export function fmtDate(iso, opts = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) {
  if (!iso) return '';
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { ...opts, timeZone: 'Europe/London' });
}
export const fmtShort = (iso) => fmtDate(iso, { weekday: 'short', day: 'numeric', month: 'short' });

export function todayIso() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
}
export function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const KIND = {
  oq: 'Oral Question', pnq: 'Private Notice Question', uq: 'Urgent Question', statement: 'Statement',
  legislation: 'Legislation', si: 'Statutory instrument', report: 'Committee report', qsd: 'Short debate',
  motion: 'Motion', other: 'Business', prayers: 'Prayers', introduction: 'Introductions',
};

export const loading = (what = 'Loading') => `<p class="state" role="status"><span class="spinner" aria-hidden="true"></span>${esc(what)}…</p>`;
export const errorBox = (err) => `<div class="state state-error" role="alert"><strong>This section couldn't load.</strong> ${esc(err?.message || err)} Try again in a minute; if it keeps failing the source may have changed its format.</div>`;
export const empty = (msg) => `<p class="state">${esc(msg)}</p>`;

export function extLink(href, label) {
  if (!href) return '';
  return `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(label)}<span class="sr-only"> (opens in a new tab)</span></a>`;
}

export function pageHeader(title, lede = '', crumbs = []) {
  const trail = crumbs.length
    ? `<nav class="crumbs" aria-label="Breadcrumb">${crumbs.map(([href, label]) => `<a href="${href}">${esc(label)}</a>`).join('<span aria-hidden="true">/</span>')}</nav>`
    : '';
  return `<header class="page-head">${trail}<h1>${esc(title)}</h1>${lede ? `<p class="lede">${lede}</p>` : ''}</header>`;
}

/** Debounce for search boxes. */
export function debounce(fn, ms = 300) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
