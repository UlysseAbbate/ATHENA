// Turns raw business text (Lords Whips' "Today's Lists", Forthcoming Business rows,
// What's On events) into one normalised shape the front end can render:
//
// { name: 'Chamber' | 'Grand Committee', start, items: [ { kind, title, detail, peers, minister,
//   dept, portfolios, groupings, notes, billId, link } ] }

import { norm, addDays, hansardQuery } from './util.js';
import { classifyPortfolios, tagText } from './portfolios.js';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

export const KIND_LABELS = {
  oq: 'Oral Question', pnq: 'Private Notice Question', uq: 'Urgent Question repeat', statement: 'Statement repeat',
  legislation: 'Legislation', si: 'Secondary legislation', report: 'Committee report', qsd: 'Question for Short Debate',
  motion: 'Motion / debate', introduction: 'Introduction', other: 'Business',
};

/** Decide what sort of business a line of text describes. `hint` is the heading it sat under. */
export function classifyKind(text, hint = '') {
  const h = String(hint).toLowerCase();
  const t = String(text).toLowerCase();
  if (/introduction/.test(h)) return 'introduction';
  if (/private notice question/.test(h) || /private notice question/.test(t)) return 'pnq';
  if (/urgent question/.test(h)) return 'uq';
  if (/oral statement|statement/.test(h)) return 'statement';
  if (/oral question/.test(h) || /to ask (his|her) majesty/.test(t)) return 'oq';
  if (/statutory instrument|orders and regulations/.test(h)) return 'si';
  if (/(regulations|order|rules|scheme|code of practice)( \(no\. ?\d+\))? 20\d\d|statutory instrument|approval motion|regret motion/.test(t)) return 'si';
  if (/\bbill\b/.test(t)) return 'legislation';
  if (/question for short debate|\bqsd\b/.test(t)) return 'qsd';
  if (/report from the|report of the|committee report|\(\d+(st|nd|rd|th) report/.test(t)) return 'report';
  if (/motion|to move|take note|debate/.test(t)) return 'motion';
  return 'other';
}

const OQ_RE = /^(.+?)\s+to ask (?:His|Her) Majesty['’]s Government\s+(.+?)\s*\(([^,()]+),\s*([^()]+)\)\s*\.?$/i;
const STATEMENT_RE = /^[‘'"“](.+?)[’'"”]\s*[–-]\s*(.+?)\s*(?:\(([^()]+)\))?\s*$/;
const PEER_RE = /\b((?:The )?(?:Lord|Baroness|Viscount|Earl|Countess|Marquess|Duke|Bishop|Archbishop|Lady) (?:of )?[A-Z][A-Za-z'’\-]+(?: (?:of|and|de|le|upon|on) [A-Z][A-Za-z'’\-]+(?: [A-Z][A-Za-z'’\-]+)*)?)/g;

export function peersIn(text) {
  const out = [];
  for (const m of String(text).matchAll(PEER_RE)) {
    const name = m[1].replace(/^The /, '').trim();
    if (!out.includes(name) && !/^Lord Speaker$/.test(name)) out.push(name);
  }
  return out;
}

function parseHeaderDate(text) {
  const m = String(text).match(/\b(MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY)\s+(\d{1,2})\s+([A-Z]+)\s+(\d{4})/i);
  if (!m) return null;
  const month = MONTHS.indexOf(m[3].toLowerCase());
  if (month < 0) return null;
  return `${m[4]}-${String(month + 1).padStart(2, '0')}-${String(Number(m[2])).padStart(2, '0')}`;
}

/**
 * Parse the plain text of https://www.lordswhips.org.uk/todays-lists.
 * The page is loosely structured, so this parser is deliberately forgiving:
 * it keys off the headings the Whips' Office uses every day.
 */
export function parseWhipsTodaysList(text) {
  const lines = String(text).split('\n').map((l) => l.trim());
  const date = parseHeaderDate(text);
  const sections = [];
  let section = null;
  let heading = '';
  let lastItem = null;
  let inGroupings = false;
  const rising = {};

  const startSection = (name, line) => {
    const start = (line.match(/at ([0-9.:]+\s*(?:am|pm))/i) || [])[1] || null;
    section = sections.find((s) => s.name === name) || { name, start, items: [] };
    if (!sections.includes(section)) sections.push(section);
    heading = ''; lastItem = null; inGroupings = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) { inGroupings = inGroupings && !!lastItem; continue; }
    if (/^notes:?$/i.test(line)) break;
    if (/^business in the chamber/i.test(line)) { startSection('Chamber', line); continue; }
    if (/^business in grand committee/i.test(line)) { startSection('Grand Committee', line); continue; }
    if (!section) continue;

    if (/^estimated rising time/i.test(line)) {
      const next = lines.slice(i + 1).find(Boolean) || '';
      rising[section.name] = next.replace(/^the (house|grand committee) is expected to rise (at )?(around|by)?\s*/i, '').replace(/\.$/, '');
      heading = 'rising'; continue;
    }
    if (heading === 'rising') continue;

    if (/^prayers\b/i.test(line)) continue;
    if (/^(oral questions|private notice question|questions on an (oral statement|urgent question)|main business|dinner break business|lunch break business|business after)/i.test(line)) {
      heading = line; inGroupings = false; continue;
    }
    if (/^grouping of amendments:?/i.test(line)) { inGroupings = true; if (lastItem) lastItem.groupings = []; continue; }
    if (inGroupings && lastItem && /^g?[A-Z]?\d+[A-Z]?(\s*,\s*g?[A-Z]?\d+[A-Z]?)*$/.test(line.replace(/\s+/g, ' '))) {
      lastItem.groupings.push(line.split(',').map((s) => s.trim()).filter(Boolean));
      continue;
    }
    inGroupings = false;

    if (/^target for the day/i.test(line) && lastItem) { lastItem.notes.push(line); continue; }

    const bullet = /^[*•·]\s*/.test(line);
    const clean = line.replace(/^[*•·]\s*/, '').trim();

    // Speaking-time guidance bullets hang off the preceding item.
    if (bullet && lastItem && /^(all members|other speakers|members('|’)? speeches|members pressing|regret motion|amendment|motion to|fatal motion|the time limit|speakers)/i.test(clean)) {
      if (/motion/i.test(clean)) lastItem.notes.push(clean);
      continue;
    }

    const kind = classifyKind(clean, heading);
    const item = { kind, title: clean, detail: '', peers: [], minister: '', dept: '', groupings: null, notes: [] };

    if (kind === 'oq' || kind === 'pnq') {
      const m = clean.match(OQ_RE);
      if (m) {
        item.peers = [m[1].trim()];
        item.title = m[2].replace(/\.$/, '').trim();
        item.detail = `${m[1].trim()} to ask HMG ${item.title}`;
        item.minister = m[3].trim();
        item.dept = m[4].trim();
      } else {
        item.peers = peersIn(clean).slice(0, 1);
      }
    } else if (kind === 'statement' || kind === 'uq') {
      const m = clean.match(STATEMENT_RE);
      if (m) { item.title = m[1].trim(); item.minister = m[2].trim(); item.dept = (m[3] || '').trim(); }
      item.detail = heading;
    } else {
      // "Railways Bill – Committee (day 1 of 2) – Lord Hendy of Richmond Hill"
      const parts = clean.split(/\s+[–-]\s+/);
      if (parts.length >= 2) {
        item.title = parts[0];
        item.detail = parts.slice(1, -1).join(' – ') || parts[1];
        item.peers = peersIn(parts[parts.length - 1]);
        if (!item.peers.length) item.detail = parts.slice(1).join(' – ');
      } else {
        item.peers = peersIn(clean).slice(0, 2);
      }
    }
    item.portfolios = classifyPortfolios(`${item.title} (${item.dept})`);
    section.items.push(item);
    lastItem = item;
  }
  return { date, sections: sections.filter((s) => s.items.length), rising };
}

const chamberFirst = (a, b) => (a.name === 'Chamber' ? 0 : 1) - (b.name === 'Chamber' ? 0 : 1);

const ORDER = { pnq: 0, oq: 1, uq: 2, statement: 3, legislation: 4, si: 5, motion: 6, report: 6, qsd: 7, other: 8 };

/** Convert What's On events for one day into sections. */
export function sectionsFromWhatsOn(events) {
  const bySection = new Map();
  for (const e of events) {
    if (e.section === 'Committees') continue;
    // Older stored rows may still carry the "Speakers list published" badge as text; it is not business.
    const cleanTitle = String(e.title || '').replace(/^\s*speakers list published\s*[\u2014\u2013-]?\s*/i, '').trim();
    if (!cleanTitle) continue;
    const kind = classifyKind(`${cleanTitle} ${e.summary}`, `${e.type} ${e.category}`);
    let title = cleanTitle;
    let detail = e.summary;
    if (kind === 'oq' || kind === 'pnq') {
      const m = `${e.title}`.match(/to ask (?:His|Her) Majesty['’]s Government\s+(.+)/i);
      if (m) title = m[1].replace(/\.$/, '');
      detail = cleanTitle;
    }
    const peersFromText = peersIn(`${cleanTitle} ${e.summary}`);
    const item = {
      kind, title, detail,
      peers: e.members.length ? e.members.map((m) => m.name) : peersFromText.slice(0, 2),
      memberParties: Object.fromEntries(e.members.map((m) => [m.name, m.party])),
      minister: '', dept: '', groupings: null, notes: [], start: e.start,
      speakersUrl: e.speakers && e.eventUrl ? e.eventUrl : '',
      portfolios: classifyPortfolios(`${cleanTitle} ${e.summary}`),
    };
    if (!bySection.has(e.section)) bySection.set(e.section, { name: e.section, start: null, items: [] });
    bySection.get(e.section).items.push(item);
  }
  const sections = [...bySection.values()];
  for (const s of sections) {
    s.items.sort((a, b) => (a.start || '').localeCompare(b.start || '') || ORDER[a.kind] - ORDER[b.kind]);
    s.start = s.items.find((i) => i.start)?.start || null;
  }
  return sections.sort(chamberFirst);
}

/** Convert Forthcoming Business rows (stored in Supabase by the GitHub Action) into sections. */
export function sectionsFromFB(rows) {
  const bySection = new Map();
  for (const r of rows.sort((a, b) => a.position - b.position)) {
    const name = /grand committee/i.test(r.section || '') ? 'Grand Committee' : 'Chamber';
    const kind = r.kind || classifyKind(r.text);
    const parts = r.text.split(/\s+[–-]\s+/);
    const item = {
      kind,
      title: parts[0],
      detail: parts.slice(1).join(' – '),
      peers: peersIn(r.text).slice(0, 3),
      minister: '', dept: r.dept || '', groupings: null, notes: [],
      portfolios: classifyPortfolios(r.text),
    };
    if (!bySection.has(name)) bySection.set(name, { name, start: null, items: [] });
    bySection.get(name).items.push(item);
  }
  return [...bySection.values()].sort(chamberFirst);
}

/**
 * The statutory instrument name(s) mentioned in a line such as "Code of Practice on X and Draft Y Regulations 2026
 * and associated regret in the name of Lord Z". Several candidates are returned, most specific first, because the
 * wording around the instrument varies. The "draft" prefix is removed.
 */
export function instrumentNames(text) {
  const re = /((?:Draft\s+)?[A-Z][\w\u2019'(),.\- ]*?(?:Regulations|Order|Rules|Scheme|Code of Practice)(?: \(No\. ?\d+\))? 20\d\d)/;
  const tidy = (n) => n.replace(/^(?:.*\b(?:of|note of) the |the )/i, '').replace(/^draft\s+/i, '').trim();
  const parts = String(text).split(/\s+(?:and|with)\s+(?:the\s+)?(?:associated\s+)?/i);
  const out = [];
  for (const p of [...parts.slice().reverse(), text]) {
    const m = String(p).match(re);
    if (m) { const n = tidy(m[1]); if (n && n.length <= 200 && !out.includes(n)) out.push(n); }
  }
  return out.slice(0, 3);
}

const normTitles = new WeakMap();
/** The Bills' titles in comparison form, worked out once per list rather than for every item checked against it. */
function billTitles(bills) {
  let t = normTitles.get(bills);
  if (!t) { t = bills.map((b) => ({ b, n: norm(b.title) })); normTitles.set(bills, t); }
  return t;
}

/** Link a business item to a live Bill (longest matching short title wins). */
export function matchBill(text, bills) {
  const t = ` ${norm(text)} `;
  let best = null;
  for (const { b, n } of billTitles(bills)) {
    if (n && t.includes(` ${n} `) && (!best || n.length > best.n.length)) best = { b, n };
  }
  return best && best.b;
}

const MAX_DEBATE_LOOKUPS = 8;

/** Add links, LD flags and bill ids to every item. */
export async function enrichSections(sections, { date, bills, isLD, findDebate }) {
  const lookups = [];
  for (const s of sections) {
    for (const item of s.items) {
      item.peers = (item.peers || []).map((name) => ({
        name,
        ld: isLD({ name, party: item.memberParties?.[name] }),
      }));
      delete item.memberParties;
      const text = `${item.title} ${item.detail}`;
      if (item.kind === 'legislation') {
        const b = matchBill(text, bills);
        if (b) {
          item.billId = b.id;
          item.link = { href: `#/bill/${b.id}`, label: 'Open Bill page', internal: true };
          if (b.portfolios && b.portfolios.length) item.portfolios = b.portfolios; // the Bill's own portfolio beats a guess from the wording
        }
        else item.link = { href: `https://bills.parliament.uk/?SearchTerm=${encodeURIComponent(item.title)}`, label: 'Find on bills.parliament.uk' };
      } else if (item.kind === 'statement' || item.kind === 'uq') {
        // The Hansard search page is the link until (and unless) the exact debate is found. Only the first few are looked up:
        // each lookup is an outside call, and an item left without an address used to be shown as a dead link.
        item.link = { href: hansardQuery(item.title, date).searchUrl, label: 'Search Hansard for the Commons statement' };
        if (lookups.length < MAX_DEBATE_LOOKUPS) {
          lookups.push(findDebate(item.title, date).then((r) => {
            item.link.href = r.url;
            item.link.label = r.exact ? 'Read the Commons statement' : 'Search Hansard for the Commons statement';
          }));
        }
      } else if (item.kind === 'si') {
        // Direct links are looked up by the page afterwards (/api/item-links); no search-page links are shown.
        const names = instrumentNames(text);
        const subject = item.title.replace(/\s+and\s+(?:the\s+)?(?:associated\s+)?regret\b.*$/i, '').trim();
        item.lookup = { si: names, lib: [...new Set([subject, ...names])].slice(0, 3) };
      } else if (item.kind === 'report') {
        const subject = item.title.replace(/^.*?\breport\s*:\s*/i, '');
        item.lookup = { report: subject, lib: [subject] };
      } else if (item.kind === 'motion' || item.kind === 'qsd' || item.kind === 'other') {
        item.link = { href: 'https://lordsbusiness.parliament.uk/', label: 'Lords Order Paper' };
        item.lookup = { lib: [item.title.slice(0, 120)] };
      }
      // Legislation (Bills and statutory instruments) is always shown under a department.
      if ((item.kind === 'legislation' || item.kind === 'si') && !(item.portfolios && item.portfolios.length)) {
        item.portfolios = tagText(`${item.title} ${item.detail || ''} ${item.dept || ''}`).codes;
      }
    }
  }
  await Promise.allSettled(lookups);
  return sections;
}

export const itemCount = (sections) => sections.reduce((n, s) => n + s.items.length, 0);

/** Weekdays between two dates inclusive. */
export function weekdays(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (wd >= 1 && wd <= 5) out.push(d);
  }
  return out;
}
