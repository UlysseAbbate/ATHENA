// Wrappers for the UK Parliament open-data APIs (https://developer.parliament.uk).
// Every wrapper normalises field names so the rest of the code does not care about
// PascalCase vs camelCase differences between APIs.

import { getJSON, getText, cached, pick, htmlToText, norm, normPeer, safe, addDays, mapLimit, hansardQuery } from './util.js';
import { markupToPlain } from './amendment-text.js';
import { whatsonRows } from './supabase.js';
import { PORTFOLIOS } from './portfolios.js';
import { tagBill } from './bill-tags.js';
import { snapshotted, readSnapshot, readSnapshots, writeSnapshot, wantsRefresh, usable } from './snapshots.js';

const BILLS = 'https://bills-api.parliament.uk/api/v1';
const MEMBERS = 'https://members-api.parliament.uk/api';
const NOW = 'https://now-api.parliament.uk/api';
const LORDS_VOTES = 'https://lordsvotes-api.parliament.uk/data';
const QS = 'https://questions-statements-api.parliament.uk/api';
const COMMITTEES = 'https://committees-api.parliament.uk/api';
const SI = 'https://statutoryinstruments-api.parliament.uk/api/v1';
const HANSARD_API = 'https://hansard-api.parliament.uk';

export const LD_PARTY_ID = 17;
export const isLDParty = (party) => /liberal democrat/i.test(String(party || ''));

/**
 * Every item of a paged Parliament list. The first page says how many there are in total, so the rest are asked
 * for together instead of one after another (this used to be 5-10 round trips in a row for the Bills and the peers).
 */
async function allPages(urlFor, pageSize, maxItems) {
  const first = await getJSON(urlFor(0));
  const out = [...(pick(first, 'items') || [])];
  if (out.length < pageSize) return out;
  const total = Number(pick(first, 'totalResults'));
  if (Number.isFinite(total) && total > 0) {
    const skips = [];
    for (let skip = pageSize; skip < Math.min(total, maxItems); skip += pageSize) skips.push(skip);
    for (const page of await Promise.all(skips.map((skip) => getJSON(urlFor(skip))))) out.push(...(pick(page, 'items') || []));
    return out;
  }
  for (let skip = pageSize; skip < maxItems; skip += pageSize) { // the total was not given: one page at a time
    const items = pick(await getJSON(urlFor(skip)), 'items') || [];
    out.push(...items);
    if (items.length < pageSize) break;
  }
  return out;
}

/* ----------------------------------------------------------- Annunciator (live) */

export async function annunciator(which = 'LordsMain') {
  const msg = await getJSON(`${NOW}/Message/message/${which}/current`, { timeout: 8000 });
  const lines = [];
  for (const slide of pick(msg, 'slides') || []) {
    for (const line of pick(slide, 'lines') || []) {
      const content = pick(line, 'content');
      if (content && String(content).trim()) lines.push({ text: htmlToText(content), style: pick(line, 'style') || '' });
      const member = pick(line, 'member');
      const memberName = member && (pick(member, 'nameDisplayAs', 'name'));
      if (memberName) lines.push({ text: memberName, style: 'member', party: pick(member, 'party', 'partyName') || '' });
    }
  }
  return { publishTime: pick(msg, 'publishTime') || null, lines };
}

/* ----------------------------------------------------------- What's On (calendar) */
// Primary source: the whatson_events table in Supabase, populated a few times a day by
// scripts/ingest_whatson.py - a real HTML parser (BeautifulSoup) that strips hidden
// accessibility text by its actual markup, rather than guessing at converted text here.
// Fallback: a live scrape of https://whatson.parliament.uk/{house}/{date}/, used only for
// dates the ingestion job hasn't reached yet (e.g. it's disabled, or the date is far out).

function dbRowToEvent(r) {
  return {
    id: null, date: r.event_date, start: r.start_time || null, end: null,
    category: r.category || '', type: r.category || '', location: '', section: r.section,
    title: r.title, summary: '',
    members: Array.isArray(r.members) ? r.members : [],
    eventUrl: r.event_url || '', speakers: !!r.speakers,
  };
}

const LINK_MARK = '\u00a7\u00a7LINK\u00a7\u00a7';
const LINK_LINE = new RegExp(`^${LINK_MARK}(\\S+)$`);

/** The What's On event address (e.g. https://whatson.parliament.uk/event/cal56556) for a link, or '' if it is not one. */
function eventUrl(href) {
  try {
    const u = new URL(href, 'https://whatson.parliament.uk/');
    if (!/(^|\.)whatson\.parliament\.uk$/.test(u.hostname) || !/^\/event\/[a-z]*\d+\/?$/i.test(u.pathname)) return '';
    return `https://whatson.parliament.uk${u.pathname.replace(/\/$/, '')}`;
  } catch { return ''; }
}

/** Put a marker line carrying the event address after every event link, so it survives the HTML-to-text step. */
function markEventLinks(html) {
  return String(html).replace(/<a\s[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>[\s\S]*?<\/a>/gi, (whole, href) => {
    const url = eventUrl(href);
    return url ? `${whole}\n${LINK_MARK}${url}\n` : whole;
  });
}

/**
 * Every Lords/Commons event on one day. Never throws - returns [] on any failure.
 * This is the live-scrape fallback; `whatsOn()` below tries Supabase first.
 * Pass `ctx` (the Cloudflare Functions context) to cache the result at the edge.
 */
export async function whatsOnDay(date, house = 'Lords', ctx = null) {
  const fetchIt = () => safe((async () => {
    const html = await getText(`https://whatson.parliament.uk/${house.toLowerCase()}/${date}/`, { timeout: 12000 });
    return parseWhatsOnDay(htmlToText(markEventLinks(html)), date);
  })(), []);
  if (!ctx) return fetchIt();
  return cached(ctx, `whatson-${house}-${date}`, 3600, fetchIt);
}

/**
 * Every event across a date range. Checks the pre-scraped Supabase table first (one query
 * for the whole range), and only live-scrapes weekdays the ingest job has not looked at (see below).
 */
export async function whatsOn(startDate, endDate, house = 'Lords', ctx = null) {
  const dates = [];
  for (let d = startDate; d <= endDate; d = addDays(d, 1)) dates.push(d);

  const fromDb = new Map();
  const covered = new Set(); // days the ingest job has already looked at, including days with no business at all
  if (ctx && ctx.env) {
    const [rows, note] = await Promise.all([
      safe(whatsonRows(ctx.env, house, startDate, endDate), []),
      house === 'Lords' ? safe(readSnapshot(ctx.env, 'whatson:ingested'), null) : null,
    ]);
    for (const r of rows) {
      if (!fromDb.has(r.event_date)) fromDb.set(r.event_date, []);
      fromDb.get(r.event_date).push(dbRowToEvent(r));
    }
    for (const d of (note && note.payload && note.payload.days) || []) covered.add(d);
  }

  // A day with no rows used to be scraped live every time, which made every weekend and every day of recess a slow outside
  // call. Now a day is only scraped if the ingest has not looked at it, and weekends (the Lords does not sit) never are.
  const isWeekend = (d) => [0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay());
  const missing = dates.filter((d) => !fromDb.has(d) && !covered.has(d) && !isWeekend(d));
  const live = await mapLimit(missing, 4, (d) => whatsOnDay(d, house, ctx)); // a few at a time: this is a live scrape of a website
  const liveByDate = new Map(missing.map((d, i) => [d, live[i]]));

  return dates.flatMap((d) => fromDb.get(d) || liveByDate.get(d) || []);
}


const SECTION_BOILERPLATE = /^tap the button to add these events to your calendar\.?$/i;
const STOP_LINE = /^(links to other uk parliament services|find events|search|advanced search|\u00A9\s*uk parliament)/i;
// Whole lines that are page chrome, not business - dropped wherever they appear.
const SKIP_LINE_RE = /(webcal:\/\/|^subscribe:|use this link to subscribe|will automatically update if events change|^add to calendar$|^download:?$)/i;
const KNOWN_SECTIONS = { chamber: 'Chamber', 'grand committee': 'Grand Committee', committees: 'Committees' };

/**
 * Strips hidden helper/accessibility text that rides along inside otherwise-real lines -
 * the screen-reader-only "View more information about X (N)" label attached to every item's
 * link, the "Download a file which will set up reminders..." calendar-button description, and any stray raw HTML attribute fragment that slipped
 * through tag-stripping. Whatever real text sits alongside this noise on the same line survives.
 */
function scrubNoise(line) {
  let s = line;
  s = s.replace(/view more information about .*?\)\s*\(\d+\)/gi, ' ');
  s = s.replace(/download:\s*/gi, ' ');
  s = s.replace(/download a file which will set up reminders[^\u2014]*/gi, ' ');
  s = s.replace(/[a-z-]+\s*=\s*"[^"]*"[^>]*>?/gi, ' '); // e.g. data-help-title="Add to calendar">
  return s.replace(/\s+/g, ' ').trim();
}

// A member's party/peerage line, e.g. "Conservative, Life peer" or "Bishop of Leicester".
// This is the single most reliable per-item marker on the page, so items are split on it.
const PARTY_LINE = /,\s*(life peer|hereditary peer|excepted hereditary)\b/i;
const BISHOP_LINE = /^(the\s+)?(lord\s+)?bishop\s+of\s+/i;
const TIME_LINE = /^\d{1,2}[.:]\d{2}\s*(am|pm)$/i;
// "Speakers list published" is a badge on a card (it follows that card's peers), read as a flag and never as text.
const SPEAKERS_LINE = /speakers list published/i;

// The business "type" label shown on each card (e.g. "Oral questions >" - the arrow, if present
// in the scraped text, is stripped before matching). Not exhaustive; anything else that looks
// like a short, plain label is still accepted as a category via the fallback in isCategoryLine.
const KNOWN_CATEGORIES = new Set([
  'oral questions', 'introduction(s)', 'introductions', 'legislation', 'statement', 'debate', 'motion',
  'statutory instrument', 'orders and regulations', 'report stage', 'committee stage', 'third reading', 'second reading',
  'question for short debate', 'committee', 'report', 'private notice question', 'urgent question',
  'petitions', 'delegated legislation', 'business questions', 'topical questions', 'adjournment debate',
  'backbench business', 'opposition day', 'estimates day', 'general debate', 'ministerial statement',
]);

function stripChevron(line) {
  return line.replace(/[\s\u3009\u203A\u00BB>]+$/, '').trim();
}

function isKnownCategory(line) {
  return KNOWN_CATEGORIES.has(stripChevron(line).toLowerCase());
}

function isCategoryLine(line) {
  const clean = stripChevron(line);
  if (!clean) return false;
  if (KNOWN_CATEGORIES.has(clean.toLowerCase())) return true;
  // Fallback: a short, punctuation-free line that isn't a party/time line either.
  return clean.split(' ').length <= 4 && !/[.:;]/.test(clean) && !PARTY_LINE.test(clean) && !TIME_LINE.test(clean);
}

/** Parse the plain-text rendering of one whatson.parliament.uk day page into events. */
export function parseWhatsOnDay(text, date) {
  const lines = text.split('\n').map((l) => l.trim());
  const events = [];
  let current = null;
  let buf = [];
  const flush = () => { if (current && buf.length) events.push(...eventsFromSectionLines(current, buf, date)); buf = []; };
  for (const line of lines) {
    const known = KNOWN_SECTIONS[line.toLowerCase()];
    if (known) { flush(); current = known; continue; }
    if (SECTION_BOILERPLATE.test(line)) continue; // chrome - the heading itself already set `current` above
    if (STOP_LINE.test(line)) { flush(); current = null; continue; }
    if (!current || !line || SKIP_LINE_RE.test(line)) continue;
    const cleaned = scrubNoise(line);
    if (cleaned) buf.push(cleaned);
  }
  flush();
  return events;
}

/**
 * Turn one section's lines into events, one per card.
 * A card reads: its text (category and title), then one or more peers (each a name line followed by a
 * party/peerage line), then optionally "Speakers list published". A card ends when the next card's text
 * begins. A name line is recognised by the party line that follows it, so a second peer on the same card
 * (e.g. the regret-motion peer on a statutory instrument) joins that card instead of becoming a new item.
 * Keep in step with events_from_section_lines() in scripts/ingest_whatson.py.
 */
function eventsFromSectionLines(headingText, lines, date) {
  const section = KNOWN_SECTIONS[headingText.toLowerCase()] || headingText;
  let startTime = null;

  // Step 1: label every line.
  const toks = [];
  for (let raw of lines) {
    const lm = raw.match(LINK_LINE);
    if (lm) { toks.push(['link', lm[1]]); continue; }
    if (TIME_LINE.test(raw)) { if (!startTime) startTime = raw; continue; } // only the first time-only line is kept
    if (SPEAKERS_LINE.test(raw)) {
      toks.push(['speakers', '']);
      raw = raw.replace(SPEAKERS_LINE, ' ').replace(/\s+/g, ' ').trim();
      if (!raw) continue;
    }
    toks.push([PARTY_LINE.test(raw) || BISHOP_LINE.test(raw) ? 'party' : 'text', raw]);
  }

  // Step 2: group the labelled lines into cards.
  const cards = [];
  let cur = null;
  let pendingLink = '';
  const newCard = () => { cur = { text: [], members: [], speakers: false, link: pendingLink, intro: false }; pendingLink = ''; cards.push(cur); };
  const giveLink = (url) => {
    if (!cur) pendingLink = url;
    else if (!cur.link) cur.link = url;
    else if (cur.link !== url) pendingLink = url; // a different address: it belongs to the next card
  };

  for (let i = 0; i < toks.length;) {
    const [kind, val] = toks[i];
    if (kind === 'link') { giveLink(val); i++; continue; }
    if (kind === 'speakers') { if (cur) cur.speakers = true; i++; continue; }
    if (kind === 'party') { i++; continue; } // a party line with no name before it
    let j = i + 1;
    while (j < toks.length && toks[j][0] === 'link') j++;
    const partyNext = j < toks.length && toks[j][0] === 'party';
    if (cur && cur.intro && !partyNext) {
      // The line after a bare "Introduction(s)" label is the peer being introduced (no party line).
      cur.members.push({ name: val, party: '', id: null });
      cur.intro = false; i++; continue;
    }
    if (partyNext) {
      if (!cur) newCard();
      for (let k = i + 1; k < j; k++) giveLink(toks[k][1]);
      cur.members.push({ name: val, party: toks[j][1], id: null });
      i = j + 1; continue;
    }
    if (!cur || cur.members.length || cur.speakers) newCard(); // the previous card has its peers: this starts the next
    cur.text.push(val);
    if (cur.text.length === 1 && /^introduction/i.test(stripChevron(val))) cur.intro = true;
    i++;
  }

  // Step 3: one event per card.
  const out = [];
  cards.forEach((c, pos) => {
    const text = [...c.text];
    let category = '';
    for (let k = 0; k < text.length; k++) {
      if (isKnownCategory(text[k])) { category = stripChevron(text[k]); text.splice(k, 1); break; }
    }
    if (!category && text.length > 1) {
      for (let k = text.length - 1; k >= 0; k--) {
        if (isCategoryLine(text[k])) { category = stripChevron(text[k]); text.splice(k, 1); break; }
      }
    }
    const title = text.join(' \u2014 ').trim() || c.members[0]?.name || category;
    if (!title) return;
    out.push({
      id: null, date, start: startTime, end: null, category, type: category, location: '', section,
      title, summary: '', members: c.members, eventUrl: c.link || '', speakers: c.speakers, position: pos,
    });
  });
  return out;
}

function normaliseEvent(e) {
  const members = (pick(e, 'Members') || []).map((m) => ({
    name: pick(m, 'Name', 'DisplayAs', 'nameDisplayAs') || '',
    party: pick(m, 'Party', 'PartyName') || '',
    id: pick(m, 'Id', 'MemberId') || null,
  }));
  const category = pick(e, 'Category') || '';
  const type = pick(e, 'Type') || '';
  const location = pick(e, 'Location') || '';
  const where = `${category} ${location} ${type}`.toLowerCase();
  let section = 'Chamber';
  if (/grand committee|moses room/.test(where)) section = 'Grand Committee';
  else if (/select|joint committee|committee/.test(where) && !/committee of the whole|chamber/.test(where)) section = 'Committees';
  return {
    id: pick(e, 'Id') || null,
    date: String(pick(e, 'StartDate') || '').slice(0, 10),
    start: pick(e, 'StartTime') || null,
    end: pick(e, 'EndTime') || null,
    category, type, location, section,
    title: String(pick(e, 'Description', 'Title') || '').trim(),
    summary: String(pick(e, 'Summary') || '').trim(),
    members,
  };
}

/* ----------------------------------------------------------- Lords Whips' Office */

/** Cached for 2 minutes - long enough to absorb repeat page views, short enough to stay current during the day. */
export async function whipsTodaysListText(ctx = null) {
  const fetchIt = async () => htmlToText(await getText('https://www.lordswhips.org.uk/todays-lists'));
  if (!ctx) return fetchIt();
  return cached(ctx, 'whips-todays-list', 120, fetchIt);
}

/* ----------------------------------------------------------- Members */

/** Current Liberal Democrat peers (Members API, party 17, House of Lords). A saved copy, renewed with the other data. */
export async function ldPeers(ctx) {
  return snapshotted(ctx, 'ld-peers-v2', 86400, async () => {
    const items = await allPages((skip) => `${MEMBERS}/Members/Search?House=2&PartyId=${LD_PARTY_ID}&IsCurrentMember=true&skip=${skip}&take=20`, 20, 200);
    return items.map((it) => {
      const v = pick(it, 'value') || it;
      return { id: pick(v, 'id'), name: pick(v, 'nameDisplayAs'), fullTitle: pick(v, 'nameFullTitle') || '', party: pick(pick(v, 'latestParty') || {}, 'name') || '' };
    });
  });
}

/** Build a matcher that tells you if a peer's name belongs to a Lib Dem. */
/**
 * Is this person a Liberal Democrat peer? `peers` is the current Lib Dem list from the Members API.
 * In order of trust:
 *   1. their Members id is on the list                      -> yes
 *   2. a party was given (Bills API, What's On)             -> believe it: Liberal Democrat or not
 *   3. no id and no party: the full name is on the list     -> yes
 *   4. a BARE name with no "of ..." part ("Lord Purvis")    -> yes if it is a Lib Dem peer's short name
 * A name is never matched by chopping the "of ..." off a name that has one: that made "Lord Thomas of Cwmgiedd"
 * (Crossbench) match "Lord Thomas of Gresford" (Lib Dem), and "Baroness Smith of Basildon" (Labour) match
 * "Baroness Smith of Newnham" (Lib Dem).
 */
export function ldMatcher(peers) {
  const ids = new Set(peers.map((p) => p.id));
  const names = new Set(peers.flatMap((p) => [normPeer(p.name), normPeer(p.fullTitle)]).filter(Boolean));
  const shortNames = new Set(peers.map((p) => normPeer(p.name).replace(/ of .*$/, '')));
  return ({ id, name, party } = {}) => {
    if (id && ids.has(id)) return true;
    if (String(party || '').trim()) return isLDParty(party);
    const n = normPeer(name);
    if (!n) return false;
    if (names.has(n)) return true;
    return !/ of /.test(n) && shortNames.has(n);
  };
}

export async function departments(ctx) {
  return snapshotted(ctx, 'departments', 86400, async () => {
    const data = await getJSON(`${MEMBERS}/Reference/Departments`);
    const list = Array.isArray(data) ? data : pick(data, 'items') || [];
    return list.map((d) => { const v = pick(d, 'value') || d; return { id: pick(v, 'id'), name: pick(v, 'name') || '', acronym: pick(v, 'acronym') || '' }; });
  });
}

/* ----------------------------------------------------------- Bills */

export async function billTypes(ctx) {
  return snapshotted(ctx, 'bill-types', 86400, async () => {
    const data = await getJSON(`${BILLS}/BillTypes?take=50`);
    return (pick(data, 'items') || []).map((t) => ({ id: pick(t, 'id'), name: pick(t, 'name') || '', category: pick(t, 'category') || '' }));
  });
}

/** All live Bills currently in the Lords, restricted to the latest session present. A saved copy, renewed with the other data. */
export async function activeLordsBills(ctx) {
  return snapshotted(ctx, 'active-lords-bills', 1800, async () => {
    const all = await allPages((skip) => `${BILLS}/Bills?CurrentHouse=Lords&IsDefeated=false&IsWithdrawn=false&SortOrder=DateUpdatedDescending&Skip=${skip}&Take=50`, 50, 400);
    const live = all.filter((b) => !pick(b, 'isAct'));
    const sessionOf = (b) => Math.max(pick(b, 'introducedSessionId') || 0, ...(pick(b, 'includedSessionIds') || [0]));
    const latest = Math.max(0, ...live.map(sessionOf));
    return live
      .filter((b) => (pick(b, 'includedSessionIds') || [pick(b, 'introducedSessionId')]).includes(latest))
      .map((b) => {
        const stage = pick(b, 'currentStage') || {};
        return {
          id: pick(b, 'billId'),
          title: pick(b, 'shortTitle'),
          billTypeId: pick(b, 'billTypeId'),
          originatingHouse: pick(b, 'originatingHouse'),
          lastUpdate: pick(b, 'lastUpdate'),
          stage: pick(stage, 'description') || '',
          stageHouse: pick(stage, 'house') || '',
        };
      });
  });
}

/** Ids of the live Lords Bills a department sponsors (the Bills API can filter by department). */
async function billIdsForDepartment(deptId) {
  const data = await getJSON(`${BILLS}/Bills?CurrentHouse=Lords&DepartmentId=${deptId}&IsDefeated=false&IsWithdrawn=false&Take=50`);
  return (pick(data, 'items') || []).map((b) => pick(b, 'billId'));
}

/**
 * The portfolio(s) of every live Bill: { [billId]: { codes, by } } (see lib/bill-tags.js; never empty for a Bill).
 * Government Bills are placed by the department that sponsors them. For the rest (Private Members' Bills and any Bill no
 * department claims) the Bill's own page is read for its long title and summary, a few per call when live (the scheduled job reads all).
 */
export async function billPortfolios(ctx) {
  return snapshotted(ctx, 'bill-portfolios', 1800, async () => {
    const [bills, depts] = await Promise.all([activeLordsBills(ctx), safe(departments(ctx), [])]);
    const lc = (x) => String(x).toLowerCase();
    const lookups = PORTFOLIOS.flatMap((p) => depts
      .filter((d) => p.departments.some((n) => lc(d.name) === lc(n) || lc(d.name).includes(lc(n))))
      .map((d) => [p.code, d.id]));

    const byDepartment = new Map(); // billId -> [portfolio codes]
    await mapLimit(lookups, 6, async ([code, deptId]) => {
      for (const billId of await safe(billIdsForDepartment(deptId), [])) {
        if (!byDepartment.has(billId)) byDepartment.set(billId, []);
        byDepartment.get(billId).push(code);
      }
    });

    const unclaimed = bills.filter((b) => !byDepartment.has(b.id));
    const details = new Map();
    await mapLimit(unclaimed.slice(0, ctx && ctx.strict ? Infinity : 8), 6, async (b) => {
      const d = await safe(bill(b.id), null);
      if (d) details.set(b.id, d);
    });

    const out = {};
    for (const b of bills) {
      const d = details.get(b.id);
      out[b.id] = tagBill({
        title: b.title,
        longTitle: pick(d, 'longTitle') || '',
        summary: pick(d, 'summary') || '',
        departmentCodes: byDepartment.get(b.id) || [],
        sponsorOrgs: (pick(d, 'sponsors') || []).map((sp) => pick(pick(sp, 'organisation') || {}, 'name')).filter(Boolean),
      });
    }
    return out;
  });
}

/** The live Lords Bills, each with `portfolios` (codes, at least one) and `portfolioBy` (how it was decided). */
export async function activeLordsBillsTagged(ctx) {
  const [bills, tags] = await Promise.all([activeLordsBills(ctx), safe(billPortfolios(ctx), {})]);
  return bills.map((b) => {
    const t = (tags && tags[b.id]) || tagBill({ title: b.title }); // a Bill newer than the saved tags: placed from its title
    return { ...b, portfolios: t.codes, portfolioBy: t.by };
  });
}

export async function bill(id) { return getJSON(`${BILLS}/Bills/${id}`); }

export async function billStages(id) {
  const data = await getJSON(`${BILLS}/Bills/${id}/Stages?take=100`);
  return (pick(data, 'items') || []).map((s) => ({
    billStageId: pick(s, 'id'),
    stageId: pick(s, 'stageId'),
    description: pick(s, 'description') || '',
    abbreviation: pick(s, 'abbreviation') || '',
    house: pick(s, 'house') || '',
    sortOrder: pick(s, 'sortOrder') || 0,
    dates: (pick(s, 'stageSittings') || []).map((x) => String(pick(x, 'date') || '').slice(0, 10)).filter(Boolean),
  })).sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * The stages (with sitting dates) of many Bills. Saved copies are used where they are good enough; the rest are looked up
 * live and saved, at most `liveBudget` per call (Cloudflare limits how many outside calls one request may make).
 * Returns { stages: { [id]: [...] }, missing: [ids not looked up this time, ask again], failed: [ids that errored] }.
 */
export async function billStagesMany(ctx, ids, liveBudget = 12) {
  const env = ctx && ctx.env;
  const forced = wantsRefresh(ctx, 'bill-stages:');
  const keyOf = (id) => `bill-stages:${id}`;
  const rows = await safe(readSnapshots(env, ids.map(keyOf)), new Map());
  const stages = {};
  const todo = [];
  for (const id of ids) {
    const row = rows.get(keyOf(id));
    if (usable(row, forced)) stages[id] = row.payload; else todo.push(id);
  }
  const failed = [];
  await Promise.all(todo.slice(0, liveBudget).map(async (id) => {
    try {
      stages[id] = await billStages(id);
      await safe(writeSnapshot(env, keyOf(id), stages[id]));
    } catch (err) {
      console.warn(`bill stages ${id}:`, err.message);
      const old = rows.get(keyOf(id));
      if (old && !ctx.strict) stages[id] = old.payload; else failed.push(id);
    }
  }));
  return { stages, missing: todo.slice(liveBudget), failed };
}

export async function billPublications(id) {
  const data = await getJSON(`${BILLS}/Bills/${id}/Publications`);
  const pubs = pick(data, 'publications') || pick(data, 'items') || [];
  return pubs.map((p) => {
    const pid = pick(p, 'id');
    const links = (pick(p, 'links') || []).map((l) => ({ title: pick(l, 'title') || 'Link', url: pick(l, 'url') }));
    const files = (pick(p, 'files') || []).map((f) => ({
      title: pick(f, 'filename') || 'Document',
      url: `${BILLS}/Publications/${pid}/Documents/${pick(f, 'id')}/Download`,
    }));
    const type = pick(p, 'publicationType') || {};
    return {
      id: pid,
      title: pick(p, 'title') || '',
      house: pick(p, 'house') || '',
      date: String(pick(p, 'displayDate') || '').slice(0, 10),
      type: pick(type, 'name') || '',
      links: [...links, ...files],
    };
  });
}

/** Every amendment tabled at one stage (paginated: the pages after the first are asked for together). */
export async function stageAmendments(billId, billStageId) {
  const out = await allPages((skip) => `${BILLS}/Bills/${billId}/Stages/${billStageId}/Amendments?Skip=${skip}&Take=100`, 100, 2000);
  return out.map((a) => ({
    id: pick(a, 'amendmentId'),
    number: pick(a, 'marshalledListText', 'amendmentNumber') || '',
    type: pick(a, 'amendmentType') || '',
    clause: pick(a, 'clause'),
    schedule: pick(a, 'schedule'),
    page: pick(a, 'pageNumber'),
    line: pick(a, 'lineNumber'),
    decision: pick(a, 'decision') || 'NoDecision',
    decisionExplanation: markupToPlain(pick(a, 'decisionExplanation') || ''),
    summary: markupToPlain((pick(a, 'summaryText') || []).join(' ')), // the API's wording carries <b>/<i> codes: plain words only
    sponsors: (pick(a, 'sponsors') || [])
      .map((s) => ({
        memberId: pick(s, 'memberId'),
        name: pick(s, 'name') || '',
        party: pick(s, 'party') || '',
        isLead: !!pick(s, 'isLead'),
        order: pick(s, 'sortOrder') || 0,
      }))
      .sort((x, y) => x.order - y.order),
  }));
}

export async function amendmentDetail(billId, billStageId, amendmentId) {
  const a = await getJSON(`${BILLS}/Bills/${billId}/Stages/${billStageId}/Amendments/${amendmentId}`);
  const lines = (pick(a, 'amendmentLines') || []).map((l) => markupToPlain(pick(l, 'textContent') || '')).filter(Boolean);
  return {
    id: amendmentId,
    location: markupToPlain(pick(a, 'amendmentLocation') || pick(a, 'mainHeader') || ''),
    text: lines,
    explanatoryStatement: markupToPlain(pick(a, 'explanatoryText') || ''),
    note: markupToPlain(pick(a, 'amendmentNote') || ''),
  };
}

/* ----------------------------------------------------------- Lords votes */

export async function lordsDivisions({ skip = 0, take = 25, searchTerm = '' } = {}) {
  let url = `${LORDS_VOTES}/Divisions/search?queryParameters.skip=${skip}&queryParameters.take=${take}`;
  if (searchTerm) url += `&queryParameters.searchTerm=${encodeURIComponent(searchTerm)}`;
  const data = await getJSON(url);
  const list = Array.isArray(data) ? data : pick(data, 'items', 'results') || [];
  return list.map((d) => {
    const contents = pick(d, 'contents') || [];
    const notContents = pick(d, 'notContents') || [];
    const ld = (arr) => arr.filter((m) => isLDParty(pick(m, 'party', 'partyName'))).length;
    const id = pick(d, 'divisionId');
    return {
      id,
      number: pick(d, 'number'),
      date: String(pick(d, 'date') || '').slice(0, 10),
      title: pick(d, 'title') || '',
      content: pick(d, 'authoritativeContentCount', 'contentCount') ?? contents.length,
      notContent: pick(d, 'authoritativeNotContentCount', 'notContentCount') ?? notContents.length,
      ldContent: ld(contents),
      ldNotContent: ld(notContents),
      url: `https://votes.parliament.uk/votes/lords/division/${id}`,
    };
  });
}

/* ----------------------------------------------------------- Written questions & statements */

export async function writtenQuestions({ skip = 0, take = 20, searchTerm = '' } = {}) {
  let url = `${QS}/writtenquestions/questions?house=Lords&expandMember=true&skip=${skip}&take=${take}`;
  if (searchTerm) url += `&searchTerm=${encodeURIComponent(searchTerm)}`;
  const data = await getJSON(url);
  return (pick(data, 'results') || []).map((r) => {
    const v = pick(r, 'value') || r;
    const m = pick(v, 'askingMember') || {};
    const tabled = String(pick(v, 'dateTabled') || '').slice(0, 10);
    const uin = pick(v, 'uin');
    return {
      id: pick(v, 'id'), uin, tabled,
      answered: String(pick(v, 'dateAnswered') || '').slice(0, 10) || null,
      heading: pick(v, 'heading') || '',
      question: htmlToText(pick(v, 'questionText') || ''),
      answer: htmlToText(pick(v, 'answerText') || ''),
      department: pick(v, 'answeringBodyName') || '',
      asker: pick(m, 'name') || '',
      askerParty: pick(m, 'party') || '',
      url: `https://questions-statements.parliament.uk/written-questions/detail/${tabled}/${uin}`,
    };
  });
}

export async function writtenStatements({ skip = 0, take = 20, searchTerm = '' } = {}) {
  let url = `${QS}/writtenstatements/statements?house=Lords&expandMember=true&skip=${skip}&take=${take}`;
  if (searchTerm) url += `&searchTerm=${encodeURIComponent(searchTerm)}`;
  const data = await getJSON(url);
  return (pick(data, 'results') || []).map((r) => {
    const v = pick(r, 'value') || r;
    const m = pick(v, 'member') || {};
    const made = String(pick(v, 'dateMade') || '').slice(0, 10);
    const uin = pick(v, 'uin');
    return {
      id: pick(v, 'id'), uin, date: made,
      title: pick(v, 'title') || '',
      text: htmlToText(pick(v, 'text') || '').slice(0, 1200),
      department: pick(v, 'answeringBodyName') || '',
      minister: pick(m, 'name') || '',
      url: `https://questions-statements.parliament.uk/written-statements/detail/${made}/${uin}`,
    };
  });
}

/* ----------------------------------------------------------- Committees */

/** The four groups committees are sorted into on the Past business -> Committees pages. */
export const COMMITTEE_CATEGORIES = {
  lords: 'House of Lords committees',
  commons: 'House of Commons Select Committees',
  joint: 'Joint Committees',
  other: 'Other Committees',
};

// Commons committees that are not select committees: public bill, delegated legislation,
// general, grand and standing committees. Matched against the committee's name and type text.
const COMMONS_NON_SELECT = /\b(delegated legislation|general|grand|standing)\s+committee\b|\bbill\s+committee\b/i;

/**
 * Which of the four groups a committee belongs to. This is the one place to change if a
 * committee lands somewhere you'd rather it didn't.
 *   Joint    -> house is Joint, or the name starts "Joint Committee"
 *   Lords    -> every committee of the House of Lords
 *   Commons  -> Commons select committees (anything Commons that isn't a bill/general/grand/delegated committee)
 *   Other    -> Commons bill, general, grand and delegated legislation committees, and anything unrecognised
 */
export function categoriseCommittee(c) {
  const house = String(c.house || '').toLowerCase();
  const name = String(c.name || '');
  if (house === 'joint' || /^joint committee\b/i.test(name)) return 'joint';
  if (house === 'lords') return 'lords';
  if (house === 'commons') return COMMONS_NON_SELECT.test(`${name} ${c.typeText || ''}`) ? 'other' : 'commons';
  return 'other';
}

/** Every current committee (Lords, Commons and Joint), each tagged with its group. Cached for six hours. */
export async function allCommittees(ctx) {
  return snapshotted(ctx, 'all-committees-v2', 21600, async () => {
    const houses = ['Lords', 'Commons', 'Joint'];
    const results = await Promise.all(houses.map((h) =>
      safe(getJSON(`${COMMITTEES}/Committees?House=${h}&CommitteeStatus=Current&Take=250`), null)));
    const seen = new Map();
    results.forEach((data, i) => {
      for (const c of (data && pick(data, 'items')) || []) {
        const id = pick(c, 'id');
        if (!id || seen.has(id)) continue;
        const types = pick(c, 'committeeTypes') || [];
        const typeText = [
          pick(pick(c, 'category') || {}, 'name'),
          ...types.flatMap((t) => [pick(t, 'name'), pick(pick(t, 'committeeCategory') || {}, 'name')]),
        ].filter(Boolean).join(' ');
        const committee = { id, name: pick(c, 'name') || '', house: pick(c, 'house') || houses[i], typeText };
        seen.set(id, {
          id, name: committee.name, house: committee.house,
          category: categoriseCommittee(committee),
          url: `https://committees.parliament.uk/committee/${id}/`,
        });
      }
    });
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  });
}

function normalisePublication(p) {
  const committee = pick(p, 'committee') || {};
  const docs = pick(p, 'documents') || [];
  const firstFile = docs.flatMap((d) => pick(d, 'files') || [])[0];
  return {
    id: pick(p, 'id'),
    title: pick(p, 'description') || '',
    type: pick(pick(p, 'type') || {}, 'name') || '',
    date: String(pick(p, 'publicationStartDate') || '').slice(0, 10),
    committee: pick(committee, 'name') || '',
    committeeHouse: pick(committee, 'house') || '',
    url: (firstFile && pick(firstFile, 'url')) || `https://committees.parliament.uk/publications/${pick(p, 'id')}/`,
  };
}

/** Up to `pageSize x maxPages` publications for one committee (the API returns them a page at a time). */
export async function committeePublications(committeeId, { pageSize = 100, maxPages = 3 } = {}) {
  const out = [];
  for (let page = 0; page < maxPages; page++) {
    const data = await getJSON(`${COMMITTEES}/Publications?CommitteeId=${committeeId}&Take=${pageSize}&Skip=${page * pageSize}`);
    const items = pick(data, 'items') || [];
    out.push(...items.map(normalisePublication));
    if (items.length < pageSize) break;
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Which heading a committee publication sits under: reports (including Government responses),
 * ministerial correspondence, minutes of meetings, or other information. Goes by the publication's
 * type first, then falls back to its title, so it still works if a type is missing or named differently.
 */
export function publicationGroup(p) {
  const type = String(p.type || '').toLowerCase();
  const title = String(p.title || '');
  if (/minutes/.test(type)) return 'minutes';
  if (/correspondence|letter/.test(type)) return 'correspondence';
  if (/report|government response/.test(type)) return 'reports';
  if (/^(formal )?minutes\b|\bminutes\s*[-\u2013]|[-\u2013]\s*minutes\b/i.test(title)) return 'minutes';
  if (/^(letter|correspondence)\b|\bletter (from|to)\b|\bcorrespondence (with|from|to)\b/i.test(title)) return 'correspondence';
  if (/^\d+(st|nd|rd|th)\s+(special\s+)?report\b|^(special\s+)?report\b|\bgovernment response\b/i.test(title)) return 'reports';
  return 'other';
}

/** True for a Government response to a committee report (shown with a small tag). */
export const isGovernmentResponse = (p) => /government response/i.test(`${p.type} ${p.title}`);

/** Recent Lords committee reports (any committee), from the last six months. */
export async function recentLordsReports(ctx, sinceIso) {
  // The saved copy has one fixed name (the date window moves every day, so a dated name would never be found again).
  return snapshotted(ctx, 'lords-reports-180d', 21600, async () => {
    const data = await getJSON(`${COMMITTEES}/Publications?StartDate=${sinceIso}&Take=250`);
    return (pick(data, 'items') || []).map(normalisePublication)
      .filter((p) => /lords/i.test(p.committeeHouse) && /report/i.test(`${p.type} ${p.title}`));
  });
}

/* ----------------------------------------------------------- Statutory instruments */

export async function statutoryInstruments({ departmentId = null, take = 50 } = {}) {
  let url = `${SI}/StatutoryInstrument?House=Lords&ParliamentaryProcessConcluded=NotConcluded&Take=${take}`;
  if (departmentId) url += `&DepartmentId=${departmentId}`;
  const data = await getJSON(url);
  const items = Array.isArray(data) ? data : pick(data, 'items') || [];
  return items.map((it) => {
    const v = pick(it, 'value') || it;
    const id = pick(v, 'id');
    return {
      id,
      name: pick(v, 'name') || '',
      laid: String(pick(v, 'layingDate', 'laidDate', 'lordsLayingDate', 'commonsLayingDate') || '').slice(0, 10) || null,
      procedure: pick(pick(v, 'procedure') || {}, 'name') || pick(v, 'procedureName') || '',
      url: `https://statutoryinstruments.parliament.uk/instrument/${id}/timeline/`,
    };
  });
}

/* ----------------------------------------------------------- Hansard */

/**
 * Try to find the Commons Hansard debate for a statement/UQ title near a date.
 * Falls back to a Hansard search URL if the API does not give a direct hit.
 */
export async function findCommonsDebate(title, dateIso) {
  const { start, cleanTitle, searchUrl } = hansardQuery(title, dateIso);
  const hit = await safe((async () => {
    const data = await getJSON(`${HANSARD_API}/search/debates.json?queryParameters.searchTerm=${encodeURIComponent(cleanTitle)}` +
      `&queryParameters.house=Commons&queryParameters.startDate=${start}&queryParameters.endDate=${dateIso}&queryParameters.take=5`, { timeout: 6000 });
    const results = pick(data, 'Results', 'results') || [];
    const best = results.find((r) => norm(pick(r, 'Title', 'DebateSection')).includes(norm(cleanTitle))) || results[0];
    if (!best) return null;
    const ext = pick(best, 'DebateSectionExtId', 'ExternalId');
    const date = String(pick(best, 'SittingDate') || '').slice(0, 10);
    if (!ext || !date) return null;
    return `https://hansard.parliament.uk/commons/${date}/debates/${ext}/${encodeURIComponent(String(pick(best, 'Title') || '').replace(/[^A-Za-z0-9]/g, ''))}`;
  })(), null);
  return { url: hit || searchUrl, exact: !!hit };
}
