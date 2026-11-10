// Wrappers for the UK Parliament open-data APIs (https://developer.parliament.uk).
// Every wrapper normalises field names so the rest of the code does not care about
// PascalCase vs camelCase differences between APIs.

import { getJSON, pick, htmlToText, norm, normPeer, safe, addDays, mapLimit, hansardQuery } from './util.js';
import { markupToPlain } from './amendment-text.js';
import { whatsonRows } from './supabase.js';
import { liveEvents } from './lordsbusiness.js';
import { PORTFOLIOS } from './portfolios.js';
import { tagBill } from './bill-tags.js';
import { snapshotted, readSnapshot, readSnapshots, writeSnapshot, wantsRefresh, usable } from './snapshots.js';

const BILLS = 'https://bills-api.parliament.uk/api/v1';
const MEMBERS = 'https://members-api.parliament.uk/api';
const NOW = 'https://now-api.parliament.uk/api';
const LORDS_VOTES = 'https://lordsvotes-api.parliament.uk/data';
const COMMONS_VOTES = 'https://commonsvotes-api.parliament.uk/data';
const QS = 'https://questions-statements-api.parliament.uk/api';
const COMMITTEES = 'https://committees-api.parliament.uk/api';
const SI = 'https://statutoryinstruments-api.parliament.uk/api/v2';   // v1 has been withdrawn; v2 is slow at times (up to a minute), so its callers are patient
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
// Primary source: the whatson_events table in Supabase, filled a few times a day by scripts/libby/ingest_whatson.py from the What's On
// API (https://whatson-api.parliament.uk/). Days the ingest has not reached are read straight from the same API (lib/libby/lordsbusiness.js).

export function dbRowToEvent(r) {
  return {
    id: null, date: r.event_date, start: r.start_time || null, end: r.end_time || null,
    category: r.category || '', type: r.category || '', location: r.location || '', section: r.section,
    title: r.title, summary: '',
    members: Array.isArray(r.members) ? r.members : [],
    eventUrl: r.event_url || '', speakers: !!r.speakers,
    eventId: r.event_id || null, billId: r.bill_id || null, billName: r.bill_name || '', committee: r.committee || '',
  };
}

/**
 * Every Lords event across a date range. Checks the stored copy first (one query for the whole range) and reads from the What's On API
 * only the weekdays the ingest job has not looked at.
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

  // A day with no rows that the ingest has looked at is a day with no business. Any other weekday is read from the API in one call.
  const isWeekend = (d) => [0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay());
  const missing = dates.filter((d) => !fromDb.has(d) && !covered.has(d) && !isWeekend(d));
  let live = [];
  if (missing.length) live = await safe(liveEvents(ctx, missing[0], missing[missing.length - 1], house), []);
  const liveByDate = new Map();
  for (const e of live) if (missing.includes(e.date)) (liveByDate.get(e.date) || liveByDate.set(e.date, []).get(e.date)).push(e);

  return dates.flatMap((d) => fromDb.get(d) || liveByDate.get(d) || []);
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

/** Current Liberal Democrat MPs (Members API, party 17, House of Commons). A saved copy, renewed with the other data. */
export async function ldMPs(ctx) {
  return snapshotted(ctx, 'ld-mps', 86400, async () => {
    const items = await allPages((skip) => `${MEMBERS}/Members/Search?House=1&PartyId=${LD_PARTY_ID}&IsCurrentMember=true&skip=${skip}&take=20`, 20, 200);
    return items.map((it) => {
      const v = pick(it, 'value') || it;
      return { id: pick(v, 'id'), name: pick(v, 'nameDisplayAs'), fullTitle: pick(v, 'nameFullTitle') || '', party: pick(pick(v, 'latestParty') || {}, 'name') || '' };
    });
  });
}

/** The Lib Dem members of one House: peers for the Lords, MPs for the Commons. */
export const ldMembers = (ctx, house = 'lords') => (house === 'commons' ? ldMPs(ctx) : ldPeers(ctx));

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
export const activeLordsBills = (ctx) => activeBills(ctx, 'Lords');

/** Every live Bill now in one House ('Lords' or 'Commons'), in the current session. */
export async function activeBills(ctx, house = 'Lords') {
  return snapshotted(ctx, house === 'Lords' ? 'active-lords-bills' : `active-${house.toLowerCase()}-bills`, 1800, async () => {
    const all = await allPages((skip) => `${BILLS}/Bills?CurrentHouse=${house}&IsDefeated=false&IsWithdrawn=false&SortOrder=DateUpdatedDescending&Skip=${skip}&Take=50`, 50, 400);
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

/** Ids of the live Bills now in one House that a department sponsors (the Bills API can filter by department). */
async function billIdsForDepartment(deptId, house = 'Lords') {
  const data = await getJSON(`${BILLS}/Bills?CurrentHouse=${house}&DepartmentId=${deptId}&IsDefeated=false&IsWithdrawn=false&Take=50`);
  return (pick(data, 'items') || []).map((b) => pick(b, 'billId'));
}

/**
 * The portfolio(s) of every live Bill, in the Commons and the Lords: { [billId]: { codes, by } } (see lib/bill-tags.js; never empty for a Bill).
 * A Government Bill is placed by the department that sponsors it (its sponsors are departments). For the rest (Private Members' Bills, whose sponsors
 * are Members, and any Bill no department claims) the Bill's own page is read for its sponsors, long title and summary, a few per call when live
 * (the scheduled job reads all).
 */
export async function billPortfolios(ctx) {
  return snapshotted(ctx, 'bill-portfolios-v2', 1800, async () => {
    const [lords, commons, depts] = await Promise.all([activeBills(ctx, 'Lords'), safe(activeBills(ctx, 'Commons'), []), safe(departments(ctx), [])]);
    const bills = [...lords, ...commons];
    const lc = (x) => String(x).toLowerCase();
    const lookups = PORTFOLIOS.flatMap((p) => depts
      .filter((d) => p.departments.some((n) => lc(d.name) === lc(n) || lc(d.name).includes(lc(n))))
      .map((d) => [p.code, d.id]));

    const byDepartment = new Map(); // billId -> [portfolio codes]
    await mapLimit(lookups.flatMap((l) => [[...l, 'Lords'], [...l, 'Commons']]), 6, async ([code, deptId, house]) => {
      for (const billId of await safe(billIdsForDepartment(deptId, house), [])) {
        if (!byDepartment.has(billId)) byDepartment.set(billId, []);
        if (!byDepartment.get(billId).includes(code)) byDepartment.get(billId).push(code);
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
export const activeLordsBillsTagged = (ctx) => activeBillsTagged(ctx, 'Lords');

/** The live Bills in one House, each with its portfolio(s). (The saved portfolio map covers the Lords Bills; any other is placed by its title.) */
export async function activeBillsTagged(ctx, house = 'Lords') {
  const [bills, tags] = await Promise.all([activeBills(ctx, house), safe(billPortfolios(ctx), {})]);
  return bills.map((b) => {
    const t = (tags && tags[b.id]) || tagBill({ title: b.title }); // a Bill newer than the saved tags: placed from its title
    return { ...b, portfolios: t.codes, portfolioBy: t.by };
  });
}

/**
 * Every Bill that has become an Act, from every session (the Bills API has no "is an Act" filter, but the Royal Assent stage, id 11, does): one list for the
 * Previous Bills tab, newest first. A Bill leaves the live lists and arrives here the day it receives Royal Assent. The portfolio is placed from the Bill's title.
 * The date is the Royal Assent sitting when the API gives one, otherwise the Bill's last update.
 */
export async function previousBills(ctx) {
  return snapshotted(ctx, 'previous-bills', 6 * 3600, async () => {
    // This query is sometimes slow on Parliament's side (a page can take 20 seconds), so: patient requests, a few at a time, each retried once.
    const url = (skip) => `${BILLS}/Bills?BillStage=11&SortOrder=DateUpdatedDescending&Skip=${skip}&Take=50`;
    const page = async (skip) => { try { return await getJSON(url(skip), { timeout: 45000 }); } catch { return getJSON(url(skip), { timeout: 45000 }); } };
    const first = await page(0);
    const total = Math.min(Number(pick(first, 'totalResults')) || 0, 2500);
    const skips = [];
    for (let skip = 50; skip < total; skip += 50) skips.push(skip);
    const rest = await mapLimit(skips, 4, page);
    const all = [first, ...rest].flatMap((p) => pick(p, 'items') || []);
    const out = all.filter((b) => pick(b, 'isAct')).map((b) => {
      const stage = pick(b, 'currentStage') || {};
      const sittings = (pick(stage, 'stageSittings') || []).map((x) => String(pick(x, 'date') || '').slice(0, 10)).filter(Boolean).sort();
      const title = pick(b, 'shortTitle') || '';
      return {
        id: pick(b, 'billId'), title, originatingHouse: pick(b, 'originatingHouse') || '', billTypeId: pick(b, 'billTypeId'),
        session: Math.max(pick(b, 'introducedSessionId') || 0, ...(pick(b, 'includedSessionIds') || [0])),
        royalAssent: sittings[sittings.length - 1] || String(pick(b, 'lastUpdate') || '').slice(0, 10),
        portfolios: tagBill({ title }).codes,
      };
    });
    out.sort((x, y) => y.royalAssent.localeCompare(x.royalAssent) || x.title.localeCompare(y.title));
    return out;
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

/** Commons divisions (Commons Votes API), with how the Lib Dem MPs voted. The search does not list the voters, so each division's own
 *  record is read for its Aye and No lists (a few at a time). */
export async function commonsDivisions({ skip = 0, take = 25, searchTerm = '' } = {}) {
  let url = `${COMMONS_VOTES}/divisions.json/search?queryParameters.skip=${skip}&queryParameters.take=${take}`;
  if (searchTerm) url += `&queryParameters.searchTerm=${encodeURIComponent(searchTerm)}`;
  const list = await getJSON(url);
  const rows = (Array.isArray(list) ? list : []).map((d) => ({
    id: pick(d, 'DivisionId'), number: pick(d, 'Number'), date: String(pick(d, 'Date') || '').slice(0, 10), title: pick(d, 'Title') || '',
    content: pick(d, 'AyeCount') ?? 0, notContent: pick(d, 'NoCount') ?? 0, ldContent: null, ldNotContent: null,
    url: `https://votes.parliament.uk/votes/commons/division/${pick(d, 'DivisionId')}`,
  }));
  await mapLimit(rows, 6, async (r) => {
    try {
      const d = await getJSON(`${COMMONS_VOTES}/division/${r.id}.json`);
      const ld = (arr) => (arr || []).filter((m) => isLDParty(pick(m, 'Party'))).length;
      r.ldContent = ld(pick(d, 'Ayes'));
      r.ldNotContent = ld(pick(d, 'Noes'));
    } catch { /* the counts stay unknown */ }
  });
  return rows;
}

/* ----------------------------------------------------------- Written questions & statements */

export async function writtenQuestions({ skip = 0, take = 20, searchTerm = '', house = 'Lords' } = {}) {
  let url = `${QS}/writtenquestions/questions?house=${house}&expandMember=true&skip=${skip}&take=${take}`;
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

export async function writtenStatements({ skip = 0, take = 20, searchTerm = '', house = 'Lords' } = {}) {
  let url = `${QS}/writtenstatements/statements?house=${house}&expandMember=true&skip=${skip}&take=${take}`;
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

/** One instrument from the SI API's list (v2), in the shape the pages use. */
export function siSummary(v) {
  const id = pick(v, 'id');
  const laidC = String(pick(v, 'commonsLayingDate') || '').slice(0, 10) || null;
  const laidL = String(pick(v, 'lordsLayingDate') || '').slice(0, 10) || null;
  const prefix = pick(v, 'paperPrefix') || '', num = pick(v, 'paperNumber'), year = pick(v, 'paperYear');
  return {
    id,
    name: pick(v, 'name') || '',
    paper: prefix && num ? `${prefix} ${year ? `${year} ` : ''}No. ${num}`.trim() : '',
    laidCommons: laidC, laidLords: laidL, laid: laidL || laidC,
    made: String(pick(v, 'paperMadeDate') || '').slice(0, 10) || null,
    procedure: pick(pick(v, 'procedure') || {}, 'name') || '',
    url: `https://statutoryinstruments.parliament.uk/instrument/${id}/timeline/`,
  };
}

/**
 * Statutory instruments from the SI API (v2). Options: name (search), procedure, concluded (true / false / undefined = both), house ('Lords' | 'Commons'), departmentId,
 * actId, skip, take. Returns { items, total }. The API can take up to a minute to answer, so the wait is long; the callers keep a saved copy.
 */
export async function statutoryInstrumentList({ name = '', procedure = '', concluded, house = '', departmentId = null, actId = '', skip = 0, take = 50 } = {}) {
  const q = new URLSearchParams({ Skip: String(skip), Take: String(take) });
  if (name) q.set('Name', name);
  if (procedure) q.set('Procedure', procedure);
  if (typeof concluded === 'boolean') q.set('ParliamentaryProcessConcluded', String(concluded));
  if (house) q.set('House', house);
  if (departmentId) q.set('DepartmentId', String(departmentId));
  if (actId) q.append('ActOfParliamentId', actId);
  const data = await getJSON(`${SI}/StatutoryInstrument?${q}`, { timeout: 90000 });
  const items = (Array.isArray(data) ? data : pick(data, 'items') || []).map((it) => siSummary(pick(it, 'value') || it));
  return { items, total: Number(pick(data, 'totalResults')) || items.length };
}

/** Every instrument whose parliamentary process is not concluded, newest laid first, as a saved copy (the API can take a minute to answer). `empty` is true when it answered with nothing at all. */
export async function openInstruments(ctx) {
  return snapshotted(ctx, 'statutory-instruments-open', 1800, async () => {
    const { items, total } = await statutoryInstrumentList({ concluded: false, take: 250 });
    if (!items.length) return { instruments: [], total: 0, empty: true };
    items.sort((x, y) => (y.laid || '').localeCompare(x.laid || '') || x.name.localeCompare(y.name));
    return { instruments: items, total, empty: false };
  });
}

/** The instruments that matter to a portfolio page: Lords instruments whose parliamentary process is not concluded (kept for the portfolio pages). */
export async function statutoryInstruments({ departmentId = null, take = 50 } = {}) {
  const { items } = await statutoryInstrumentList({ house: 'Lords', concluded: false, departmentId, take });
  return items.map((i) => ({ id: i.id, name: i.name, laid: i.laid, procedure: i.procedure, url: i.url }));
}

/** One instrument in full: laying body, procedure, dates, the Acts it is made under, its timelines, and the business items (the steps in each House). */
export async function statutoryInstrumentDetail(id) {
  const [d, items] = await Promise.all([
    getJSON(`${SI}/StatutoryInstrument/${encodeURIComponent(id)}`, { timeout: 90000 }),
    safe(getJSON(`${SI}/StatutoryInstrument/${encodeURIComponent(id)}/BusinessItems`, { timeout: 90000 }), null),
  ]);
  const v = pick(d, 'value') || d;
  const list = Array.isArray(items) ? items : pick(items || {}, 'items') || [];
  return {
    ...siSummary(v),
    comingIntoForce: String(pick(v, 'paperComingIntoForceDate') || '').slice(0, 10) || null,
    comingIntoForceNote: pick(v, 'paperComingIntoForceNote') || '',
    layingBody: pick(pick(v, 'layingBody') || {}, 'name') || '',
    followedBy: pick(pick(v, 'followedByInstrument') || {}, 'name') || '',
    precededBy: pick(pick(v, 'precededByInstrument') || {}, 'name') || '',
    enablingActs: (pick(v, 'enablingActs') || []).map((a) => ({ id: pick(a, 'id'), name: pick(a, 'name') || '', year: pick(a, 'year') || null, number: pick(a, 'number') || null, link: pick(a, 'link') || '' })),
    timelines: (pick(v, 'timelines') || []).map((t) => ({ id: pick(t, 'id'), name: pick(t, 'name') || '', date: String(pick(t, 'dateTime') || '').slice(0, 10) })).sort((a, b) => a.date.localeCompare(b.date)),
    steps: list.map((b) => ({
      id: pick(b, 'id'), date: String(pick(b, 'itemDate') || '').slice(0, 10), link: pick(b, 'link') || '', sequence: pick(b, 'sequence') || 0,
      houses: pick(b, 'houses') || [], steps: (pick(b, 'steps') || []).map((x) => (typeof x === 'string' ? x : pick(x, 'name', 'description', 'title') || '')).filter(Boolean),
    })).sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.sequence - b.sequence),
  };
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
