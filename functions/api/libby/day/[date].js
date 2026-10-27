// GET /api/day/:date  (date = YYYY-MM-DD or "today")
// The business for one sitting day, from the best available source:
//   0. The Today's List PDF uploaded by Staff for that day (lib/list-store.js), when there is one
//   1. The Lords' own Order Paper for that day (Lords Business API)
//   2. The Lords' Future Business (the same API, for the coming weeks)
//   3. The Parliament What's On API calendar (any date) — also used on top of 1 and 2 for the Bill, the speakers list and the committees
// The Lords Business and What's On APIs are the only sources. Each is read from the copy Supabase holds (renewed several times a day by
// scripts/libby/ingest_lordsbusiness.py and ingest_whatson.py) and, for a day the copy does not hold, straight from the API.

import { json, safe, londonToday, addDays, isIsoDate, hansardQuery } from '../../../../lib/libby/util.js';
import { snapshotted } from '../../../../lib/libby/snapshots.js';
import { sanitizeList, cleanSettings, listToSections, weekdayOf } from '../../../../lib/libby/list-store.js';
import { mergeRules } from '../../../../site/libby/js/docs/sitting-times.js';
import { SAVED_DAYS_AHEAD } from '../../../../lib/libby/schedule.js'; // today and the coming week have a saved copy; older days are rarely opened
import { whatsOn, activeLordsBillsTagged, ldPeers, ldMatcher, findCommonsDebate } from '../../../../lib/libby/parliament.js';
import { sectionsFromWhatsOn, sectionsFromFB, committeesFromWhatsOn, mergeWhatsOn, risingFromWhatsOn, enrichSections, itemCount } from '../../../../lib/libby/business.js';
import { fbRows, orderPaperRows, sbSelect, supabaseConfigured } from '../../../../lib/libby/supabase.js';
import { liveOrderPaper, liveFutureBusiness } from '../../../../lib/libby/lordsbusiness.js';

const SOURCES = {
  whatson: { label: "UK Parliament — What's On", url: 'https://whatson.parliament.uk/lords/' },
  orderpaper: { label: 'House of Lords — Order Paper', url: 'https://lordsbusiness.parliament.uk/' },
  fb: { label: 'House of Lords — Future Business', url: 'https://lordsbusiness.parliament.uk/' },
};

/** The business for one day, put together from every source. Takes a few outside calls, which is why today and the coming week are saved. */
async function buildDay(ctx, date, today) {
  const { env } = ctx;
  // The stored copy first; the API itself for a day the copy does not hold (the paper may have come out since the last ingest).
  const stored = (rows, live) => safe(rows, []).then((r) => (r.length ? r : live()));
  const [events, fb, orderPaper, bills, peers] = await Promise.all([
    safe(whatsOn(date, date, 'Lords', ctx), []),
    date >= today ? stored(fbRows(env, date, date), () => liveFutureBusiness(ctx, date, date)) : Promise.resolve([]),
    date >= today ? stored(orderPaperRows(env, date, date), () => liveOrderPaper(ctx, date)) : Promise.resolve([]),
    safe(activeLordsBillsTagged(ctx), []),
    safe(ldPeers(ctx), []),
  ]);

  const candidates = [];
  const opSections = sectionsFromFB(orderPaper);
  if (itemCount(opSections)) candidates.push({ key: 'orderpaper', sections: opSections, rising: {} });
  const fbSections = sectionsFromFB(fb);
  if (itemCount(fbSections)) candidates.push({ key: 'fb', sections: fbSections, rising: {} });
  const wo = sectionsFromWhatsOn(events);
  if (itemCount(wo)) candidates.push({ key: 'whatson', sections: wo, rising: {} });

  // The Lords' own papers, newest word first: the Order Paper, then Future Business, then the calendar.
  const chosen = ['orderpaper', 'fb', 'whatson'].map((k) => candidates.find((c) => c.key === k)).find(Boolean) ||
    { key: null, sections: [], rising: {} };
  // The calendar adds what the papers do not say: the Bill, the speakers list, the room, and the committees meeting that day.
  if (chosen.key && chosen.key !== 'whatson') mergeWhatsOn(chosen.sections, events);
  if (!Object.keys(chosen.rising || {}).length) chosen.rising = risingFromWhatsOn(events);
  const committees = committeesFromWhatsOn(events);
  if (committees && !chosen.sections.some((s) => s.name === 'Committees')) chosen.sections.push(committees);

  const isLD = ldMatcher(peers);
  await enrichSections(chosen.sections, { date, bills, isLD, findDebate: findCommonsDebate });

  return {
    date,
    source: chosen.key ? { key: chosen.key, ...SOURCES[chosen.key] } : null,
    otherSources: candidates.filter((c) => c !== chosen).map((c) => ({ key: c.key, ...SOURCES[c.key] })),
    rising: chosen.rising,
    sections: chosen.sections,
    ldPeers: peers.map((p) => p.name),
  };
}

const UPLOADED = { key: 'upload', label: 'Government Whips\u2019 Office \u2014 Today\u2019s List (uploaded PDF)', url: '' };

/** The uploaded list for a day, as the day's business (with links and Lib Dem flags), and what Staff have set for it. */
async function uploadedDay(ctx, date, row, rulesRow) {
  const list = sanitizeList(row.data);
  const settings = cleanSettings(row.settings);
  const [bills, peers] = await Promise.all([safe(activeLordsBillsTagged(ctx), []), safe(ldPeers(ctx), [])]);
  const isLD = ldMatcher(peers);
  const sections = listToSections(list);
  // The Hansard link for a statement is the search page: looking each one up live would hold the page up on every view.
  await enrichSections(sections, { date, bills, isLD, findDebate: async (title, when) => ({ url: hansardQuery(title, when).searchUrl, exact: false }) });
  for (const sec of sections) {
    for (const item of sec.items) {
      if (item.speakers) item.speakers = item.speakers.map((sp) => ({ ...sp, ld: isLD({ name: sp.full }) }));
      const added = (settings.items[item.key] && settings.items[item.key].speakers) || [];
      item.addedSpeakers = added.map((sp) => ({ name: sp.name, ld: isLD({ name: sp.name }) }));
    }
  }
  return {
    sections,
    rising: Object.fromEntries(sections.filter((s) => s.rising).map((s) => [s.name, s.rising])),
    settings,
    rules: mergeRules(rulesRow && rulesRow.value),
    list: { date, uploadedAt: row.uploaded_at, uploadedBy: row.uploaded_by || '', updatedAt: row.updated_at },
  };
}

export async function onRequestGet(ctx) {
  const { params, env } = ctx;
  const today = londonToday();
  const date = params.date === 'today' ? today : params.date;
  if (!isIsoDate(date)) return json({ error: 'Use a date in the form YYYY-MM-DD.' }, { status: 400 });

  const saved = date >= today && date <= addDays(today, SAVED_DAYS_AHEAD);
  const db = supabaseConfigured(env);
  const [day, uploaded, duty, rules] = await Promise.all([
    saved ? snapshotted(ctx, `day:${date}`, 300, () => buildDay(ctx, date, today)) : buildDay(ctx, date, today),
    db ? safe(sbSelect(env, 'todays_lists', `select=data,settings,uploaded_by,uploaded_at,updated_at&list_date=eq.${date}`), []) : [],
    db ? safe(sbSelect(env, 'duty_whips', `select=slot,whip&duty_date=eq.${date}&order=slot.asc`), []) : [],
    db ? safe(sbSelect(env, 'site_settings', 'select=value&key=eq.sitting_rules'), []) : [],
  ]);

  // isToday is worked out now, not kept in the saved copy: tomorrow's copy is made today but read tomorrow.
  const out = { ...day, isToday: date === today, weekday: weekdayOf(date), dutyWhips: duty.map((r) => r.whip).filter(Boolean), list: null, settings: null };
  if (uploaded[0]) {
    try {
      const up = await uploadedDay(ctx, date, uploaded[0], rules[0]);
      // The uploaded list is the Whips' own and the best source: the other sources are offered underneath it.
      Object.assign(out, up, { source: UPLOADED, otherSources: [day.source, ...day.otherSources].filter(Boolean) });
    } catch (err) {
      console.warn('uploaded list could not be used:', err.message);
      out.listProblem = 'The uploaded list for this day could not be read, so the business below comes from the other sources.';
    }
  }
  // Staff change this and expect to see it at once, and the duty Whips come from the Whips page: nothing here is kept by the browser.
  return json(out, { maxAge: 0 });
}
