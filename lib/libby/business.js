// Turns the Lords' business (Order Paper and Future Business rows from the Lords Business API,
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
  motion: 'Motion / debate', introduction: 'Introduction', committee: 'Committee', other: 'Business',
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

const chamberFirst = (a, b) => (a.name === 'Chamber' ? 0 : 1) - (b.name === 'Chamber' ? 0 : 1);

const ORDER = { pnq: 0, oq: 1, uq: 2, statement: 3, legislation: 4, si: 5, motion: 6, report: 6, qsd: 7, other: 8 };

/** Convert What's On events for one day into sections. */
export function sectionsFromWhatsOn(events) {
  const bySection = new Map();
  for (const e of events) {
    if (e.section === 'Committees' || /^estimated rising time$/i.test(String(e.category || '').trim())) continue;   // (rising times are read by risingFromWhatsOn)
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
      speakersEventId: e.speakers && e.eventId ? e.eventId : null,
      eventId: e.eventId || null, location: e.location || '', end: e.end || null, billId: e.billId || null,
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

/** When each place is expected to rise, from the calendar's "Estimated rising time" events: { Chamber: '22:00', 'Grand Committee': '20:45' }. */
export function risingFromWhatsOn(events) {
  const out = {};
  for (const e of events) if (/^estimated rising time$/i.test(String(e.category || '').trim()) && e.start && e.section) out[e.section] = e.start;
  return out;
}

/**
 * The committee meetings in a day's What's On events (select and joint committees: the committee, its room and times) as a "Committees"
 * section, or null if there are none. The chamber and Grand Committee come from the Order Paper or Future Business, not from here.
 */
export function committeesFromWhatsOn(events) {
  const items = events.filter((e) => e.section === 'Committees' && (e.committee || e.title)).map((e) => ({
    kind: 'committee', title: e.committee || e.title, detail: [e.category, e.location].filter(Boolean).join(' \u00B7 '),
    peers: [], minister: '', dept: '', groupings: null, notes: [], start: e.start, end: e.end, eventId: e.eventId || null, portfolios: [],
  }));
  if (!items.length) return null;
  items.sort((a, b) => (a.start || '').localeCompare(b.start || '') || a.title.localeCompare(b.title));
  return { name: 'Committees', start: null, items };
}

/**
 * Add what the What's On calendar knows to the items of a day built from the Order Paper or Future Business: the event (and so
 * its speakers list), the Bill's own id, the room, the start time. An item is matched by its wording, or by its Bill's name.
 */
export function mergeWhatsOn(sections, events) {
  const evs = events.filter((e) => e.section !== 'Committees' && e.title).map((e) => ({ e, key: norm(e.title), bill: norm(e.billName) }));
  for (const s of sections) {
    for (const item of s.items) {
      const key = norm(item.title).slice(0, 40);
      if (!key) continue;
      const hit = evs.find((x) => (item.kind === 'legislation' && x.bill && norm(item.title).startsWith(x.bill)) || (x.key.length >= 12 && (x.key.includes(key) || key.includes(x.key.slice(0, 40)))));
      if (!hit) continue;
      const e = hit.e;
      item.eventId ||= e.eventId || null;
      item.start ||= e.start || null;
      item.end ||= e.end || null;
      item.location ||= e.location || '';
      if (e.billId && !item.billId) item.billId = e.billId;
      if (e.speakers && e.eventId) { item.speakersEventId = e.eventId; item.speakersUrl = e.eventUrl || ''; }
    }
  }
  return sections;
}

/** Convert Forthcoming Business or Order Paper rows (stored in Supabase by scripts/libby/ingest_lordsbusiness.py) into sections. */
/**
 * "Advisory speaking time: 5 minutes" and a line of speaking peers are part of the debate they follow, not business of their own: they are taken
 * out of the list and put on that debate (`backbenchMinutes`, `speakers`) so the page shows them under it and can time each speaker.
 */
export function foldSpeakerLines(sections) {
  for (const sec of sections) {
    const kept = [];
    for (const it of sec.items) {
      const text = `${it.title || ''} ${it.detail || ''}`.trim();
      const prev = kept[kept.length - 1];
      const advisory = /^(?:advisory|backbench)[^.]{0,40}\btime\b|^speaking time\b/i.test(text) && text.match(/(\d{1,2})\s*(?:minutes?|mins?)\b/i);
      const names = !advisory && /^(?:speakers?|speaking|those speaking|list of speakers)\b/i.test(text) ? peersIn(text.replace(/^[^:]*:/, '')) : [];
      if (prev && advisory) { prev.backbenchMinutes = Number(advisory[1]); prev.noLimit = true; continue; }
      if (prev && names.length) { prev.speakers = names.map((full, i) => ({ n: i + 1, name: full, full })); continue; }
      kept.push(it);
    }
    sec.items = kept;
  }
  return sections;
}

export function sectionsFromFB(rows) {
  const bySection = new Map();
  for (const r of rows.sort((a, b) => a.position - b.position)) {
    const name = /grand committee/i.test(r.section || '') ? 'Grand Committee' : 'Chamber';
    const kind = r.kind || classifyKind(r.text);
    const parts = r.text.split(/\s+[–-]\s+/);
    // An Oral Question reads "Lord X to ask His Majesty's Government what...": the question is the title, the peer is who asks it.
    const ask = (kind === 'oq' || kind === 'pnq') && r.text.match(/^(.+?)\s+to ask (?:His|Her) Majesty['’]s Government\s+(.+)$/i);
    const item = {
      kind,
      title: ask ? ask[2].replace(/\.$/, '') : parts[0],
      detail: ask ? '' : parts.slice(1).join(' – '),
      peers: ask ? [ask[1].replace(/^\W+/, '')] : peersIn(r.text).slice(0, 3),
      memberId: r.member_id || null,
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
      item.peers = (item.peers || []).map((name, n) => ({
        name,
        ld: isLD({ id: n === 0 ? item.memberId : null, name, party: item.memberParties?.[name] }),
      }));
      delete item.memberParties;
      delete item.memberId;
      const text = `${item.title} ${item.detail}`;
      if (item.kind === 'legislation') {
        const b = (item.billId && bills.find((x) => x.id === item.billId)) || matchBill(text, bills);
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
