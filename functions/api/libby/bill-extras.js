// GET /api/bill-extras
// The two extra columns on the Legislation page:
//   nextDates  { [billId]: { date, stage, source } }  earliest upcoming Lords business that names the Bill,
//                                                      found in the What's On calendar (stored in Supabase)
//                                                      and, when it has been loaded, Forthcoming Business.
//   advisers   { [billId]: { name, by, at } }          typed in on the adviser-editor page.
// Next dates are cached for 10 minutes; advisers are always read fresh so edits show straight away.
// Every outside call has a time limit, so a slow service gives a note rather than an endless wait.

import { json, errorResponse, cached, norm, londonToday, addDays } from '../../../lib/libby/util.js';
import { activeLordsBills } from '../../../lib/libby/parliament.js';
import { classifyKind, matchBill } from '../../../lib/libby/business.js';
import { sbSelect, supabaseConfigured, whatsonRows, fbRows } from '../../../lib/libby/supabase.js';

const LOOK_AHEAD_DAYS = 56;
const SOURCE_TIMEOUT_MS = 8000;
const BILLS_TIMEOUT_MS = 15000;

/** Rejects if the promise has not settled within `ms` milliseconds. */
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not answer within ${ms / 1000} seconds`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Runs one source with a time limit. On failure, records the problem and returns the fallback. */
async function settle(promise, label, problems, fallback) {
  try {
    return await withTimeout(promise, SOURCE_TIMEOUT_MS, label);
  } catch (err) {
    problems.push(`${label}: ${err.message}`);
    return fallback;
  }
}

/** Which Lords stage a piece of business is. `rest` is the text with the Bill's own title removed. */
function stageLabel(rest, section) {
  if (/third reading|3rd reading/.test(rest)) return '3rd reading';
  if (/consideration of commons|commons amendments|commons reasons|ping pong/.test(rest)) return 'Commons amendments';
  if (/second reading|2nd reading/.test(rest)) return '2nd reading';
  if (/\breport\b/.test(rest)) return 'Report stage';
  if (/committee/.test(rest) || section === 'Grand Committee') return 'Committee stage';
  return '';
}

async function computeNextDates(env, bills, from, to) {
  const problems = [];
  const [events, fb] = await Promise.all([
    settle(whatsonRows(env, 'Lords', from, to), "What's On calendar", problems, []),
    settle(fbRows(env, from, to), 'Forthcoming Business', problems, []),
  ]);
  const best = {};
  const consider = (date, text, hint, section, source) => {
    if (!date || date < from || section === 'Committees') return;
    if (classifyKind(text, hint) !== 'legislation') return;
    const b = matchBill(text, bills);
    if (!b) return;
    if (best[b.id] && best[b.id].date <= date) return;
    // Remove the Bill's own title first, so words inside it (e.g. "Annual Report") can't be mistaken for a stage.
    const rest = norm(`${hint} ${text}`).replace(norm(b.title), ' ');
    best[b.id] = { date, stage: stageLabel(rest, section), source };
  };
  for (const e of events) consider(e.event_date, e.title || '', e.category || '', e.section, "What's On");
  for (const r of fb) consider(r.business_date, r.text || '', '', r.section, 'Forthcoming Business');
  return { nextDates: best, calendarRows: events.length, fbRows: fb.length, problems };
}

export async function onRequestGet(ctx) {
  const { env } = ctx;
  try {
    const today = londonToday();
    const notes = [];

    // The list of Bills. If it is slow, dates cannot be matched to Bills, so none are shown this time.
    let bills = [];
    let billsOk = true;
    try {
      bills = await withTimeout(activeLordsBills(ctx), BILLS_TIMEOUT_MS, 'The list of Bills');
    } catch (err) {
      billsOk = false;
      notes.push(`Next dates are not shown this time: ${err.message}. Try again in a minute.`);
    }

    // Next dates are cached only when every source answered. A partial result is shown once and not kept.
    let fresh = null;
    let data;
    try {
      if (!billsOk) throw new Error('skipped because the list of Bills did not load');
      data = await cached(ctx, `bill-next-dates-${today}`, 600, async () => {
        fresh = await computeNextDates(env, bills, today, addDays(today, LOOK_AHEAD_DAYS));
        if (fresh.problems.length) throw new Error('partial result, not cached');
        return fresh;
      });
    } catch (err) {
      if (fresh) {
        data = fresh;
      } else {
        data = { nextDates: {}, calendarRows: 0, fbRows: 0, problems: [] };
      }
    }
    for (const p of data.problems || []) {
      notes.push(`${p} did not answer in time, so some dates may be missing. Try again in a minute.`);
    }

    const advisers = {};
    if (!supabaseConfigured(env)) {
      notes.push('Supabase settings are missing in Cloudflare, so advisers and the calendar cannot be read.');
    } else {
      try {
        const rows = await withTimeout(
          sbSelect(env, 'bill_advisers', 'select=bill_id,advisers,updated_by,updated_at'),
          SOURCE_TIMEOUT_MS,
          'Advisers table'
        );
        for (const r of rows) if (r.advisers) advisers[r.bill_id] = { name: r.advisers, by: r.updated_by || '', at: r.updated_at || '' };
      } catch (err) {
        notes.push(`Advisers could not be read (has the bill_advisers table been created in Supabase?): ${err.message}`);
      }
      if (billsOk && !data.calendarRows && !(data.problems || []).length) {
        notes.push("The What's On calendar has no upcoming rows in the database, so no dates can be shown yet.");
      }
    }

    return json({ nextDates: data.nextDates, advisers, notes }, { maxAge: 0 });
  } catch (err) {
    return errorResponse(err);
  }
}
