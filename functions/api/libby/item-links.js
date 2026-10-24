// GET /api/item-links?si=<names, separated by |>&report=<report subject>&lib=<phrases, separated by |>[&debug=1]
// Finds DIRECT links for one business item (never a search page):
//   instrument  the statutory instrument's own page (Statutory Instruments API)
//   report      the committee report's own page (Committees API)
//   library     the Lords Library briefing (the Lords Library website's WordPress search)
// A link is returned only when the title matches; otherwise that link is null and the page shows nothing.
// `debug=1` adds a "trace" showing what each service returned, to help diagnose a missing link.
// Answers are saved (lib/snapshots.js), so each item is looked up once rather than on every view of the page; "Refresh now" looks them up again.

import { json, errorResponse, getJSON, pick, norm, londonToday, addDays, decodeEntities } from '../../../lib/libby/util.js';
import { snapshotted } from '../../../lib/libby/snapshots.js';
import { recentLordsReports } from '../../../lib/libby/parliament.js';

const SI = 'https://statutoryinstruments-api.parliament.uk/api/v1';
const LIBRARY = 'https://lordslibrary.parliament.uk/wp-json/wp/v2/search';

/** A title reduced for comparison: no "draft", no leading "the", no punctuation. */
const core = (s) => norm(String(s || '').replace(/<[^>]+>/g, ' ').replace(/^\s*(the\s+)?draft\s+/i, '').replace(/^\s*the\s+/i, ''));

/** Same title, or one wholly contains the other (and the shorter is long enough to be specific). */
function sameTitle(a, b) {
  const x = core(a);
  const y = core(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 25 && long.includes(short);
}

const list = (v, max) => String(v || '').split('|').map((s) => s.trim()).filter(Boolean).slice(0, max);

async function findInstrument(names, trace) {
  for (const name of names) {
    const url = `${SI}/StatutoryInstrument?Name=${encodeURIComponent(name)}&Take=20`;
    const data = await getJSON(url, { timeout: 9000 });
    const items = (Array.isArray(data) ? data : pick(data, 'items') || []).map((it) => pick(it, 'value') || it);
    trace.push(`SI search "${name}": ${items.length} result(s): ${items.slice(0, 5).map((v) => pick(v, 'name')).join(' / ')}`);
    const hit = items.find((v) => sameTitle(pick(v, 'name'), name));
    if (hit && pick(hit, 'id')) {
      return { href: `https://statutoryinstruments.parliament.uk/instrument/${pick(hit, 'id')}/timeline/`, label: 'Find the instrument' };
    }
  }
  return null;
}

async function findLibrary(phrases, trace) {
  for (const phrase of phrases) {
    const url = `${LIBRARY}?search=${encodeURIComponent(phrase.slice(0, 120))}&per_page=10&_fields=title,url,subtype`;
    const data = await getJSON(url, { timeout: 9000 });
    const results = Array.isArray(data) ? data : [];
    const titleOf = (r) => decodeEntities(String(pick(r, 'title') || ''));
    trace.push(`Library search "${phrase.slice(0, 60)}": ${results.length} result(s): ${results.slice(0, 5).map(titleOf).join(' / ')}`);
    const hit = results.find((r) => pick(r, 'url') && sameTitle(titleOf(r), phrase));
    if (hit) return { href: pick(hit, 'url'), label: 'Lords Library' };
  }
  return null;
}

async function findReport(ctx, subject, trace) {
  const reports = await recentLordsReports(ctx, addDays(londonToday(), -180));
  trace.push(`Committee reports in the last six months: ${reports.length}`);
  const hit = reports.find((r) => sameTitle(r.title, subject));
  return hit && hit.url ? { href: hit.url, label: 'Find the report' } : null;
}

async function sha(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestGet(ctx) {
  try {
    const q = new URL(ctx.request.url).searchParams;
    const si = list(q.get('si'), 3);
    const lib = list(q.get('lib'), 3);
    const report = String(q.get('report') || '').slice(0, 300).trim();
    const debug = q.get('debug') === '1';
    if (!si.length && !lib.length && !report) return json({ error: 'Pass ?si=, ?report= or ?lib=.' }, { status: 400 });

    const work = async () => {
      const trace = [];
      // Each lookup is independent: one failing must not hide the others.
      const attempt = async (label, fn) => {
        try { return await fn(); } catch (err) { trace.push(`${label} failed: ${err.message}`); return null; }
      };
      const [instrument, reportLink, library] = await Promise.all([
        si.length ? attempt('Instrument lookup', () => findInstrument(si, trace)) : null,
        report ? attempt('Report lookup', () => findReport(ctx, report, trace)) : null,
        lib.length ? attempt('Library lookup', () => findLibrary(lib, trace)) : null,
      ]);
      return { instrument, report: reportLink, library, trace };
    };

    const key = `item-links-${await sha(`${si.join('|')}#${report}#${lib.join('|')}`)}`;
    let data;
    if (debug) data = await work();
    else {
      try {
        // A lookup that hit a network error is returned but not remembered, so it is retried next time.
        data = await snapshotted(ctx, `links:${key}`, 3600, async () => {
          const d = await work();
          if (d.trace.some((t) => /failed:/.test(t))) { const e = new Error('transient'); e.data = d; throw e; }
          return d;
        });
      } catch (err) {
        if (err.data) data = err.data; else throw err;
      }
    }
    const { trace, ...links } = data;
    return json(debug ? { ...links, trace } : links, { maxAge: debug ? 0 : 1800 });
  } catch (err) {
    return errorResponse(err);
  }
}
