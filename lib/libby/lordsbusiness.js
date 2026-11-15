// The two official Parliament APIs that LIBBY's Forthcoming and Today's business come from, read directly:
//   What's On API        https://whatson-api.parliament.uk/              the calendar (events, members, Bills, speakers, committees)
//   Lords Business API   https://services.lordsbusiness.parliament.uk/   the House's own Order Paper and Future Business
// The ingest jobs (scripts/libby/ingest_whatson.py, ingest_lordsbusiness.py) keep a copy in Supabase; the functions here are the same
// mapping in JavaScript, used for a day the copy does not hold yet. scripts/libby/check-business.mjs checks the two agree.

import { getJSON, cached, safe, addDays } from './util.js';

export const WHATSON = 'https://whatson-api.parliament.uk';
export const LORDS_BUSINESS = 'https://services.lordsbusiness.parliament.uk';
export const ORDER_PAPER = 38;
export const FUTURE_BUSINESS = 39;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/* ------------------------------------------------------------------ What's On */

const SECTION_OF_TYPE = { 'main chamber': 'Chamber', 'grand committee': 'Grand Committee' };   // anything else is "Committees"
// The Commons sits in more places: the Chamber, Westminster Hall and the general (public bill and delegated legislation) committees.
const COMMONS_SECTION_OF_TYPE = { 'main chamber': 'Chamber', 'westminster hall': 'Westminster Hall', 'general committee': 'General Committees' };
export const whatsonSection = (type, house = 'Lords') =>
  (house === 'Commons' ? COMMONS_SECTION_OF_TYPE : SECTION_OF_TYPE)[String(type || '').trim().toLowerCase()] || 'Committees';

/** What the business is called: chamber items carry it in Description; committee meetings have the committee's name instead. */
function eventTitle(e) {
  const desc = String(e.Description || '').replace(/\s+/g, ' ').trim();
  return desc || e.Committee?.Description || String(e.Category || '').trim();
}

/** The API's event list as the event objects the business code uses (the same shape as a stored row read back by dbRowToEvent). */
export function eventsFromApi(list, house = 'Lords') {
  const out = [];
  const seen = new Map();
  const sorted = [...(list || [])].sort((a, b) => String(a.StartDate).localeCompare(String(b.StartDate)) || (a.SortOrder || 0) - (b.SortOrder || 0) || String(a.StartTime || '').localeCompare(String(b.StartTime || '')));
  for (const e of sorted) {
    const date = String(e.StartDate || '').slice(0, 10);
    if (e.CancelledDate || !ISO_DAY.test(date) || String(e.House || house).toLowerCase() !== house.toLowerCase()) continue;
    const position = seen.get(date) || 0;
    seen.set(date, position + 1);
    out.push({
      id: null, date, start: e.StartTime || null, end: e.EndTime || null,
      category: e.Category || '', type: e.Category || '', location: e.Location || '', section: whatsonSection(e.Type, house),
      title: eventTitle(e), summary: '',
      members: (e.Members || []).filter((m) => m.Name).map((m) => ({ name: m.Name, party: m.Party || '', id: m.Id || null })),
      eventUrl: e.Id ? `https://whatson.parliament.uk/event/cal${e.Id}` : '', speakers: !!e.HasSpeakers,
      eventId: e.Id || null, billId: e.BillId || null, billName: e.BillName || '', committee: e.Committee?.Description || '', position,
    });
  }
  return out;
}

// The What's On API answers "An error has occurred" (400) to a range of more than about a month, so a longer range is asked for a fortnight at a time
// (the same size as the Lords ingest's batches, scripts/libby/ingest_whatson.py).
export const WHATSON_CHUNK_DAYS = 14;
export const whatsonUrl = (house, from, to) => `${WHATSON}/calendar/events/list.json?queryParameters.house=${house}&queryParameters.startDate=${from}&queryParameters.endDate=${to}`;

/** One House's events from `from` to `to` (YYYY-MM-DD), straight from the What's On API. Saved for ten minutes. */
export function liveEvents(ctx, from, to, house = 'Lords') {
  const fetchIt = async () => {
    const ranges = [];
    for (let start = from; start <= to; start = addDays(start, WHATSON_CHUNK_DAYS)) {
      const end = addDays(start, WHATSON_CHUNK_DAYS - 1);
      ranges.push([start, end > to ? to : end]);
    }
    const lists = await Promise.all(ranges.map(([a, b]) => getJSON(whatsonUrl(house, a, b), { timeout: 20000 })));
    return eventsFromApi(lists.flat(), house);
  };
  return ctx ? cached(ctx, `whatson-api-${house}-${from}-${to}`, 600, fetchIt) : fetchIt();
}

/* ------------------------------------------------------------------ Lords Business */

// What kind of business a line is. Keep in step with classify_kind() in scripts/libby/common.py.
export function classifyKind(text, hint = '') {
  const t = String(text).toLowerCase();
  const h = String(hint).toLowerCase();
  if (h.includes('private notice question') || t.includes('private notice question')) return 'pnq';
  if (h.includes('urgent question')) return 'uq';
  if (h.includes('statement')) return 'statement';
  if (h.includes('oral question') || /to ask (his|her) majesty/.test(t)) return 'oq';
  if (/(regulations|order|rules|scheme|code of practice)( \(no\. ?\d+\))? 20\d\d|approval motion|regret motion/.test(t)) return 'si';
  if (/\bbill\b/.test(t)) return 'legislation';
  if (t.includes('question for short debate')) return 'qsd';
  if (/report (from|of) the|\(\d+(st|nd|rd|th) report/.test(t)) return 'report';
  if (/motion|to move|take note|debate/.test(t)) return 'motion';
  return 'other';
}
const DEPT_RE = /[(,]\s*([A-Za-z]{2,6})\)\s*[‡†]*\s*$/;
const HEADING_RE = /^(oral questions?|private notice question|questions on an (oral statement|urgent question)|main business|dinner break business|lunch break business|estimated rising time|business in the chamber|business in grand committee|grand committee|chamber)\b/i;

/** The API's plain text without the non-breaking spaces, daggers and asterisks that only matter on the printed paper. */
const plain = (text) => String(text || '').replace(/ /g, ' ').replace(/^[\s*†‡•]+/, '').replace(/\s+/g, ' ').trim();
/** A line in italics alone (a heading such as "Oral questions (40 minutes)", or a note) is not an item of business. */
const isNote = (it) => { const f = String(it.DisplayTextFormatted || '').trim(); return f.startsWith('<em>') && f.endsWith('</em>') && !f.includes('<strong>'); };

function kindOf(text, hint) {
  if (/\bwill be introduced\b/i.test(text)) return 'introduction';
  const kind = classifyKind(text);
  return (kind === 'other' || kind === 'motion') && hint ? classifyKind(text, hint) : kind;
}

/** Rows (the shape stored in whips_business) for one sitting day's block from GetData. `source` is 'fb' or 'todays_list'. */
export function businessRows(day, source, businessDate) {
  const rows = [];
  const add = (section, items) => {
    let hint = '';
    let position = 0;
    for (const it of items || []) {
      const text = plain(it.DisplayTextPlain);
      if (!text) continue;
      if (isNote(it)) { if (HEADING_RE.test(text)) hint = text; continue; }
      const itemHint = hint;
      hint = '';
      const dept = DEPT_RE.exec(text);
      rows.push({
        source, business_date: businessDate, section, position: position++, text, kind: kindOf(text, itemHint),
        dept: dept ? dept[1].toUpperCase() : null, item_id: it.ItemOfBusinessId ?? null, member_id: it.MainMemberId ?? null,
      });
    }
  };
  const chamber = day.ChamberContent || {};
  add('Chamber', chamber.ItemsOfBusiness);
  for (const sub of chamber.SubSections || []) add('Chamber', sub?.ItemsOfBusiness);
  for (const gc of day.GrandCommitteeContent || []) add('Grand Committee', gc?.ItemsOfBusiness);
  return rows;
}

/** [[date, day block]] from the Future Business document (GetData, section 39). */
export const futureBusinessDays = (doc) => (doc?.Business || []).map((b) => [String(b.Date || '').slice(0, 10), b]).filter(([d]) => ISO_DAY.test(d));

/** The Order Paper's rows for one day, straight from the Lords Business API; [] if there is none yet. Saved for two minutes. */
export function liveOrderPaper(ctx, date) {
  const fetchIt = async () => {
    const sections = await getJSON(`${LORDS_BUSINESS}/api/v1/GetSectionsForDate.json?businessPaperDate=${date}`, { timeout: 15000 });
    if (!Array.isArray(sections) || !sections.includes(ORDER_PAPER)) return [];
    return businessRows(await getJSON(`${LORDS_BUSINESS}/api/v1/GetData.json?BusinessPaperDate=${date}&SectionId=${ORDER_PAPER}`, { timeout: 20000 }), 'todays_list', date);
  };
  return safe(ctx ? cached(ctx, `lb-order-paper-${date}`, 120, fetchIt) : fetchIt(), []);
}

/** Future Business rows for the days from `from` to `to`, straight from the Lords Business API. Saved for ten minutes. */
export function liveFutureBusiness(ctx, from, to) {
  const fetchIt = async () => {
    const doc = await getJSON(`${LORDS_BUSINESS}/api/v1/GetData.json?BusinessPaperDate=${from}&SectionId=${FUTURE_BUSINESS}`, { timeout: 20000 });
    return futureBusinessDays(doc).flatMap(([d, block]) => businessRows(block, 'fb', d)).filter((r) => r.business_date >= from && r.business_date <= to);
  };
  return safe(ctx ? cached(ctx, `lb-future-${from}-${to}`, 600, fetchIt) : fetchIt(), []);
}

/* ------------------------------------------------------------------ deadlines: the notes that say when a ballot is drawn or something must be tabled */

const DEADLINE_RE = /\b(ballot|deadline|tabled|tabling|closes|closing|not later than|no later than|must be (?:submitted|tabled|received))\b/i;
const plainText = (t) => String(t || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

/** The notes in one day's block of the Order Paper or Future Business that give a deadline (for example "Topical oral question. Ballot to be drawn at 1pm on Friday 13 November.").
 *  The papers print these as italic lines under the item they belong to; they are not items of business, so the business rows leave them out. [{ section, text }] */
export function deadlineNotes(block) {
  const out = [], seen = new Set();
  const scan = (section, items) => {
    for (const it of items || []) {
      const text = plainText(it?.DisplayTextPlain);
      if (!text || !DEADLINE_RE.test(text)) continue;
      const f = String(it?.DisplayTextFormatted || '').trim();
      if (!(f.startsWith('<em>') && f.endsWith('</em>'))) continue;   // a note, not an item of business that happens to use the word
      const key = `${section}|${text}`;
      if (!seen.has(key)) { seen.add(key); out.push({ section, text }); }
    }
  };
  const chamber = block?.ChamberContent || {};
  scan('Chamber', chamber.ItemsOfBusiness);
  for (const sub of chamber.SubSections || []) scan('Chamber', sub?.ItemsOfBusiness);
  for (const gc of block?.GrandCommitteeContent || []) scan('Grand Committee', gc?.ItemsOfBusiness);
  return out;
}

/** The deadlines for one sitting day, read from Future Business and the Order Paper. Saved for ten minutes. [] when there are none. */
export function liveDeadlines(ctx, date) {
  const fetchIt = async () => {
    const fb = await getJSON(`${LORDS_BUSINESS}/api/v1/GetData.json?BusinessPaperDate=${date}&SectionId=${FUTURE_BUSINESS}`, { timeout: 20000 });
    const op = await getJSON(`${LORDS_BUSINESS}/api/v1/GetData.json?BusinessPaperDate=${date}&SectionId=${ORDER_PAPER}`, { timeout: 20000 }).catch(() => null);
    const blocks = [...futureBusinessDays(fb).filter(([d]) => d === date).map(([, b]) => b), ...(op && Array.isArray(op.Business) ? op.Business : op ? [op] : [])];
    const seen = new Set();
    return blocks.flatMap(deadlineNotes).filter((n) => !seen.has(n.text) && seen.add(n.text));
  };
  return safe(ctx ? cached(ctx, `lb-deadlines-${date}`, 600, fetchIt) : fetchIt(), []);
}
