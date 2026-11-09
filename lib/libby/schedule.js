// When the saved copy of the Parliament data is renewed. London times, every day.
// This is the ONE place the times are written: the scheduled job (.github/workflows/refresh-data.yml) asks
// scripts/refresh-window.mjs, which reads this list, and the site's "next update" message reads it too.
// To change the times, change the list below and nothing else.

export const REFRESH_HOURS = [6, 18];

/** London hour and minute for a moment. */
export function londonClock(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date);
  const get = (t) => Number(parts.find((p) => p.type === t).value) % 24;
  return { hour: get('hour'), minute: get('minute') };
}

/** True if it is one of the update hours in London (GitHub's timer can run late, so the whole hour counts). */
export function isRefreshHour(date = new Date()) {
  return REFRESH_HOURS.includes(londonClock(date).hour);
}

/** The next update after this moment: { hour, tomorrow } (London time). */
export function nextRefresh(date = new Date()) {
  const { hour, minute } = londonClock(date);
  const now = hour * 60 + minute;
  const later = REFRESH_HOURS.find((h) => h * 60 > now);
  return later === undefined ? { hour: REFRESH_HOURS[0], tomorrow: true } : { hour: later, tomorrow: false };
}

// What the scheduled job saves, so the routes and the job always agree.
/** Days with a saved copy on the Today / day page: today and this many days after it. */
export const SAVED_DAYS_AHEAD = 7;
/** Lengths (in days) of the calendar on the Future page that have a saved copy (home page 14, default 28, Future page 35). */
export const SAVED_FUTURE_LENGTHS = [14, 28, 35];

/**
 * The start of the update slot we are in: the most recent REFRESH_HOURS time (London) at or before `date`, as a Date.
 * GitHub starts scheduled runs hours late, so "is it 6am now?" is the wrong question. The right one is "has anything been updated since the
 * last 6am or 6pm?": if not, the update is due, however late the run started.
 */
export function lastSlotStart(date = new Date()) {
  const offsetAt = (utc) => new Date(utc.toLocaleString('en-US', { timeZone: 'Europe/London' })) - new Date(utc.toLocaleString('en-US', { timeZone: 'UTC' }));
  const day = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const slots = [];
  for (const back of [0, 1]) {
    const [y, m, d] = day(new Date(date.getTime() - back * 864e5)).split('-').map(Number);
    for (const h of REFRESH_HOURS) {
      const guess = new Date(Date.UTC(y, m - 1, d, h));
      slots.push(new Date(guess.getTime() - offsetAt(guess)));
    }
  }
  return slots.filter((s) => s <= date).sort((a, b) => b - a)[0];
}

/** True if nothing has been updated since the current slot began (`last` is when the last update finished; a missing or invalid time counts as never). */
export const updateIsDue = (last, now = new Date()) => !(last instanceof Date ? last : new Date(last)).getTime() || (last instanceof Date ? last : new Date(last)) < lastSlotStart(now);
