// Calendar pieces shared by the Duty Whips page (Advisers) and the Availability page (Whips): five weeks, Monday to Friday, laid out like the
// Future calendar, with the availability colours.
import { esc, fmtDate, todayIso, addDays } from './ui.js';

export const WEEKS = 5; // weeks shown at a time, Monday to Friday

export function mondayOf(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  return addDays(iso, -((d.getUTCDay() + 6) % 7));
}
export const rangeFrom = (query) => mondayOf(/^\d{4}-\d{2}-\d{2}$/.test(query.from || '') ? query.from : todayIso());

/** Five weeks, Monday to Friday, laid out like the Future calendar. cellHtml(date) draws one day. */
export function weeksGrid(from, cellHtml) {
  const today = todayIso();
  const rows = [];
  for (let w = 0; w < WEEKS; w++) {
    rows.push(`<div class="cal-row" role="row">${[0, 1, 2, 3, 4].map((i) => cellHtml(addDays(from, w * 7 + i), today)).join('')}</div>`);
  }
  return `<div class="cal" role="table" aria-label="Calendar">
    <div class="cal-row cal-headrow" role="row">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d) => `<div role="columnheader">${d}</div>`).join('')}</div>${rows.join('')}</div>`;
}

export function calNav(base, from) {
  const last = addDays(from, WEEKS * 7 - 3);
  const fmt = (d) => fmtDate(d, { day: 'numeric', month: 'short', year: 'numeric' });
  return `<nav class="cal-nav" aria-label="Move the calendar">
    <a class="button button-quiet" href="${base}?from=${addDays(from, -WEEKS * 7)}">Earlier</a>
    <a class="button button-quiet" href="${base}">This week</a>
    <a class="button button-quiet" href="${base}?from=${addDays(from, WEEKS * 7)}">Later</a>
    <span class="small muted">${esc(fmt(from))} to ${esc(fmt(last))}</span></nav>`;
}

export const STATUS_LABEL = { green: 'Prefer to be duty whip', amber: 'No preference', red: 'Not free' };
export const legendHtml = () => `<p class="avail-legend" aria-label="Key">${['green', 'amber', 'red'].map((s) => `<span class="avail-${s}"><i class="avail-dot"></i>${esc(STATUS_LABEL[s])}</span>`).join('')}</p>`;

/** { date: { whip: status } } from the list the server sends. */
export function availabilityMap(entries) {
  const m = {};
  for (const e of entries || []) (m[e.date] ||= {})[e.whip] = e.status;
  return m;
}
